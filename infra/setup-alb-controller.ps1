# Installs the AWS Load Balancer Controller on the EKS cluster via helm with
# IRSA, so Ingress resources provision ALBs. Run once (idempotent) from the
# repo root:
#   powershell -ExecutionPolicy Bypass -File infra/setup-alb-controller.ps1
$ErrorActionPreference = "Stop"
$region = "us-east-1"
$clusterName = "eventmart"
$vpcId = "vpc-03e6c2384d5cfde0b"
$policyName = "eventmart-aws-lb-controller"
$saName = "aws-load-balancer-controller"
$accountId = aws sts get-caller-identity --query Account --output text
$policyArn = "arn:aws:iam::${accountId}:policy/$policyName"

$eksKubeconfig = Join-Path $HOME ".kube/eksctl/clusters/eventmart"
if (Test-Path $eksKubeconfig) {
    $env:KUBECONFIG = $eksKubeconfig
}

if (-not (Get-Command helm -ErrorAction SilentlyContinue)) {
    Write-Host "helm not found, installing via winget..."
    winget install --id Helm.Helm --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
if (-not (Get-Command helm -ErrorAction SilentlyContinue)) {
    throw "helm is not available on PATH. Install it manually (https://helm.sh/docs/intro/install/) and re-run."
}

Write-Host "Ensuring IAM policy $policyName..."
$existing = aws iam list-policies --scope Local --query "Policies[?PolicyName=='$policyName'].Arn" --output text
if (-not $existing) {
    aws iam create-policy --policy-name $policyName --policy-document file://infra/aws/aws-lb-controller-policy.json | Out-Null
    Write-Host "Created $policyArn"
} else {
    Write-Host "Policy already exists: $policyArn"
}

Write-Host "Associating IAM OIDC provider with cluster $clusterName..."
eksctl utils associate-iam-oidc-provider --cluster $clusterName --region $region --approve

Write-Host "Creating/updating IRSA service account $saName in kube-system..."
eksctl create iamserviceaccount `
    --cluster $clusterName `
    --region $region `
    --namespace kube-system `
    --name $saName `
    --override-existing-serviceaccounts `
    --attach-policy-arn $policyArn `
    --approve

Write-Host "Installing AWS Load Balancer Controller via helm..."
helm repo add eks https://aws.github.io/eks-charts 2>$null
helm repo update | Out-Null
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller `
    --namespace kube-system `
    --set clusterName=$clusterName `
    --set region=$region `
    --set vpcId=$vpcId `
    --set serviceAccount.create=false `
    --set serviceAccount.name=$saName

Write-Host "Waiting for controller rollout..."
kubectl rollout status deployment/aws-load-balancer-controller -n kube-system --timeout=180s

Write-Host "Done. Controller pods:"
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller

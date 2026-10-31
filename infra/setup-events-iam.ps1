# Creates the IAM policy for domain events and wires it to the EKS cluster via
# IRSA (IAM Roles for Service Accounts) as service account 'eventmart-events'.
# Run once (idempotent) from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/setup-events-iam.ps1
$ErrorActionPreference = "Stop"
$region = "us-east-1"
$policyName = "eventmart-events"
$accountId = aws sts get-caller-identity --query Account --output text
$policyArn = "arn:aws:iam::${accountId}:policy/$policyName"

$eksKubeconfig = Join-Path $HOME ".kube/eksctl/clusters/eventmart"
if (Test-Path $eksKubeconfig) {
    $env:KUBECONFIG = $eksKubeconfig
}

Write-Host "Ensuring IAM policy $policyName..."
$existing = aws iam list-policies --scope Local --query "Policies[?PolicyName=='$policyName'].Arn" --output text
if (-not $existing) {
    aws iam create-policy --policy-name $policyName --policy-document file://infra/aws/events-policy.json | Out-Null
    Write-Host "Created $policyArn"
} else {
    Write-Host "Policy already exists: $policyArn"
}

Write-Host "Associating IAM OIDC provider with cluster eventmart..."
eksctl utils associate-iam-oidc-provider --cluster eventmart --region $region --approve

Write-Host "Creating/updating IRSA service account eventmart-events..."
eksctl create iamserviceaccount `
    --cluster eventmart `
    --region $region `
    --namespace eventmart `
    --name eventmart-events `
    --attach-policy-arn $policyArn `
    --approve

Write-Host "Done. Service account:"
kubectl get serviceaccount eventmart-events -n eventmart

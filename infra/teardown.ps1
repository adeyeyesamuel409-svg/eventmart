# Tears down the EventMart AWS foundation - run from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/teardown.ps1
# Order matters: the ALB must go first (otherwise it leaks after cluster
# deletion), then the EKS cluster ENIs sit inside the stack's VPC, so the
# cluster must go before the stack (shared VPC - eksctl will not delete it).
$ErrorActionPreference = "Continue"
$stackName = "eventmart-foundation"
$region = "us-east-1"

$eksKubeconfig = Join-Path $HOME ".kube/eksctl/clusters/eventmart"
if (Test-Path $eksKubeconfig) {
    $env:KUBECONFIG = $eksKubeconfig
}

Write-Host "1/3 Deleting ingress (ALB) and AWS Load Balancer Controller..."
kubectl delete ingress eventmart -n eventmart --ignore-not-found
Start-Sleep -Seconds 30
helm uninstall aws-load-balancer-controller -n kube-system 2>$null

Write-Host "2/3 Deleting EKS cluster 'eventmart' (10-15 min)..."
eksctl delete cluster --name eventmart --region $region --wait

Write-Host "3/3 Deleting CloudFormation stack $stackName..."
aws cloudformation delete-stack --stack-name $stackName --region $region
aws cloudformation wait stack-delete-complete --stack-name $stackName --region $region
Write-Host "Teardown complete. Verify with: aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=eventmart"

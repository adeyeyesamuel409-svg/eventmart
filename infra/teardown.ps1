# Tears down the EventMart AWS foundation - run from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/teardown.ps1
# Order matters: the EKS cluster ENIs sit inside the stack's VPC,
# so the cluster must go first (shared VPC - eksctl will not delete it).
$ErrorActionPreference = "Continue"
$stackName = "eventmart-foundation"
$region = "us-east-1"

Write-Host "1/2 Deleting EKS cluster 'eventmart' (10-15 min)..."
eksctl delete cluster --name eventmart --region $region --wait

Write-Host "2/2 Deleting CloudFormation stack $stackName..."
aws cloudformation delete-stack --stack-name $stackName --region $region
aws cloudformation wait stack-delete-complete --stack-name $stackName --region $region
Write-Host "Teardown complete. Verify with: aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=eventmart"

# Deploys the EventMart foundation stack (if needed) and creates the EKS cluster
# from the CloudFormation outputs. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/deploy-cluster.ps1
$ErrorActionPreference = "Stop"
$stackName = "eventmart-foundation"
$region = "us-east-1"

Write-Host "Reading stack outputs from $stackName..."
$outputs = aws cloudformation describe-stacks --stack-name $stackName --region $region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
function Get-Out($key) {
    $entry = $outputs | Where-Object { $_.OutputKey -eq $key }
    if (-not $entry) { throw "Missing stack output: $key" }
    return $entry.OutputValue
}

$template = Get-Content "infra/eks/cluster.yaml.tpl" -Raw
$template = $template.Replace("{{VPC_ID}}", (Get-Out "VpcId"))
$template = $template.Replace("{{PRIVATE_SUBNET_A}}", (Get-Out "PrivateSubnetAId"))
$template = $template.Replace("{{PRIVATE_SUBNET_B}}", (Get-Out "PrivateSubnetBId"))
$template = $template.Replace("{{PUBLIC_SUBNET_A}}", (Get-Out "PublicSubnetAId"))
$template = $template.Replace("{{PUBLIC_SUBNET_B}}", (Get-Out "PublicSubnetBId"))
Set-Content -Path "infra/eks/cluster.yaml" -Value $template
Write-Host "Wrote infra/eks/cluster.yaml"

Write-Host "Creating EKS cluster (this takes 10-15 minutes)..."
eksctl create cluster -f infra/eks/cluster.yaml --auto-kubeconfig
if ($?) {
    Write-Host "Cluster created. Nodes:"
    kubectl get nodes
}

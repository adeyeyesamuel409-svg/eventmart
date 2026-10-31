# Installs the CloudWatch Observability add-on (Container Insights) on the EKS
# cluster: container/pod metrics, dashboards and logs in CloudWatch. Run once
# (idempotent) from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/setup-observability.ps1
$ErrorActionPreference = "Stop"
$region = "us-east-1"
$clusterName = "eventmart"
$roleName = "AmazonEKSAmazonCloudWatchObservabilityRole"

function Invoke-Aws {
    param([string[]]$AwsArgs, [switch]$AllowFailure)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & aws @AwsArgs 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if (-not $AllowFailure -and $code -ne 0) { throw "aws $($AwsArgs -join ' ') failed" }
    return $output
}

Write-Host "Creating IRSA role for the CloudWatch Observability add-on..."
eksctl create iamserviceaccount `
    --cluster $clusterName `
    --region $region `
    --namespace amazon-cloudwatch-observability `
    --name amazon-cloudwatch-observability `
    --role-name $roleName `
    --role-only `
    --override-existing-serviceaccounts `
    --attach-policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy `
    --attach-policy-arn arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess `
    --approve

$roleArn = Invoke-Aws @("iam", "get-role", "--role-name", $roleName, "--query", "Role.Arn", "--output", "text")
Write-Host "Role: $roleArn"

Write-Host "Patching trust policy for the add-on's service accounts..."
Invoke-Aws @("iam", "update-assume-role-policy", "--role-name", $roleName,
    "--policy-document", "file://infra/aws/cloudwatch-observability-trust.json") | Out-Null

$existing = Invoke-Aws @("eks", "describe-addon", "--cluster-name", $clusterName, "--region", $region,
    "--addon-name", "amazon-cloudwatch-observability") -AllowFailure
if ($existing) {
    Write-Host "Add-on exists, updating..."
    Invoke-Aws @("eks", "update-addon", "--cluster-name", $clusterName, "--region", $region,
        "--addon-name", "amazon-cloudwatch-observability",
        "--service-account-role-arn", $roleArn, "--resolve-conflicts", "OVERWRITE") | Out-Null
} else {
    Write-Host "Creating add-on..."
    Invoke-Aws @("eks", "create-addon", "--cluster-name", $clusterName, "--region", $region,
        "--addon-name", "amazon-cloudwatch-observability",
        "--service-account-role-arn", $roleArn, "--resolve-conflicts", "OVERWRITE") | Out-Null
}

Write-Host "Waiting for add-on to become ACTIVE (a few minutes)..."
Invoke-Aws @("eks", "wait", "addon-active", "--cluster-name", $clusterName, "--region", $region,
    "--addon-name", "amazon-cloudwatch-observability")
Write-Host "Add-on ACTIVE"

Write-Host ""
Write-Host "Verify metrics flow in ~2 min with:"
Write-Host "  aws cloudwatch list-metrics --namespace ContainerInsights --dimensions Name=ClusterName,Value=$clusterName"
Write-Host "Dashboards: CloudWatch console -> ContainerInsights -> EKS -> $clusterName"

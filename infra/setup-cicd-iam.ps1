# Creates the GitHub Actions CI/CD identity: an IAM OIDC provider for GitHub,
# a role assumable only by this repo's main branch, and EKS cluster admin
# access for the deploy step. Run once (idempotent) from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/setup-cicd-iam.ps1
$ErrorActionPreference = "Stop"
$region = "us-east-1"
$clusterName = "eventmart"
$roleName = "eventmart-github-actions"
$accountId = aws sts get-caller-identity --query Account --output text
$roleArn = "arn:aws:iam::${accountId}:role/$roleName"
$oidcProvider = "token.actions.githubusercontent.com"
$oidcArn = "arn:aws:iam::${accountId}:oidc-provider/$oidcProvider"

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

Write-Host "Ensuring GitHub OIDC provider..."
$providers = Invoke-Aws @("iam", "list-open-id-connect-providers", "--query", "OpenIDConnectProviderList[].Arn", "--output", "text")
if ($providers -notmatch [regex]::Escape($oidcArn)) {
    Invoke-Aws @("iam", "create-open-id-connect-provider",
        "--url", "https://$oidcProvider",
        "--thumbprint-list", "cabd2a79a1076a31f21d253635cb039d4329a5e8", "6938fd4d98bab03faadb97b34396831e3780aea1",
        "--client-id-list", "sts.amazonaws.com") | Out-Null
    Write-Host "Created $oidcArn"
} else {
    Write-Host "OIDC provider already exists: $oidcArn"
}

Write-Host "Ensuring IAM role $roleName..."
$roleExists = Invoke-Aws @("iam", "get-role", "--role-name", $roleName) -AllowFailure
if (-not $roleExists) {
    Invoke-Aws @("iam", "create-role",
        "--role-name", $roleName,
        "--assume-role-policy-document", "file://infra/aws/github-actions-trust.json",
        "--description", "GitHub Actions CI/CD for eventmart (OIDC, main branch only)") | Out-Null
    Write-Host "Created $roleArn"
} else {
    Write-Host "Role already exists: $roleArn"
    Invoke-Aws @("iam", "update-assume-role-policy",
        "--role-name", $roleName,
        "--policy-document", "file://infra/aws/github-actions-trust.json")
    Write-Host "Updated trust policy"
}

Invoke-Aws @("iam", "put-role-policy",
    "--role-name", $roleName,
    "--policy-name", "$roleName-inline",
    "--policy-document", "file://infra/aws/github-actions-policy.json") | Out-Null
Write-Host "Attached inline policy"

Write-Host "Granting EKS cluster admin to $roleName..."
Invoke-Aws @("eks", "create-access-entry", "--cluster-name", $clusterName, "--region", $region,
    "--principal-arn", $roleArn, "--type", "STANDARD") -AllowFailure | Out-Null
Invoke-Aws @("eks", "associate-access-policy", "--cluster-name", $clusterName, "--region", $region,
    "--principal-arn", $roleArn, "--access-scope", "type=cluster",
    "--policy-arn", "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy") | Out-Null
Write-Host "Access entry configured"

Write-Host ""
Write-Host "Done. Repo variable needed by the workflow:"
Write-Host "  gh variable set AWS_ROLE_ARN --body `"$roleArn`""

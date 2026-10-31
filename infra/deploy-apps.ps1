# Deploys the EventMart microservices to the EKS cluster.
# Creates/updates the DB secret from AWS Secrets Manager, then applies the
# manifests in infra/k8s. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File infra/deploy-apps.ps1
$ErrorActionPreference = "Stop"
$region = "us-east-1"
$dbSecretId = "eventmart/db"

$eksKubeconfig = Join-Path $HOME ".kube/eksctl/clusters/eventmart"
if (Test-Path $eksKubeconfig) {
    $env:KUBECONFIG = $eksKubeconfig
}

Write-Host "Reading DB credentials from Secrets Manager ($dbSecretId)..."
$creds = aws secretsmanager get-secret-value --secret-id $dbSecretId --region $region --query SecretString --output text | ConvertFrom-Json

Write-Host "Applying namespace..."
kubectl apply -f infra/k8s/namespace.yaml

$sa = kubectl get serviceaccount eventmart-events -n eventmart 2>$null
if (-not $?) {
    throw "Service account eventmart-events not found. Run infra/setup-events-iam.ps1 first."
}

Write-Host "Creating/updating secret eventmart-db..."
kubectl create secret generic eventmart-db -n eventmart `
    --from-literal=DB_USER=$($creds.username) `
    --from-literal=DB_PASSWORD=$($creds.password) `
    --dry-run=client -o yaml | kubectl apply -f -

Write-Host "Applying manifests..."
kubectl apply -f infra/k8s/

Write-Host "Waiting for rollouts..."
foreach ($app in "catalog", "orders", "cart", "payments", "notifications") {
    kubectl rollout status deployment/$app -n eventmart --timeout=180s
    if (-not $?) { throw "deployment $app did not become ready" }
}

Write-Host "Deployed. Pods:"
kubectl get pods -n eventmart

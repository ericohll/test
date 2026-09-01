#!/usr/bin/env bash
# Tears down everything deploy.sh created. Idempotent -- safe to re-run,
# including against a stack that is already gone. Exits non-zero on failure.
set -euo pipefail
cd "$(dirname "$0")"

NAME_PREFIX="app-79dad50c-0e543650"
REGION="ap-southeast-1"
STACK_NAME="${NAME_PREFIX}-quality-dashboard"
ARTIFACTS_BUCKET="${NAME_PREFIX}-artifacts"

empty_bucket() {
  local bucket="$1"
  if aws s3api head-bucket --bucket "$bucket" --region "$REGION" 2>/dev/null; then
    echo "==> Emptying bucket $bucket"
    aws s3 rm "s3://$bucket" --recursive --region "$REGION" || true
  fi
}

echo "==> Looking up stack outputs (if the stack still exists)"
if OUTPUTS_JSON=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output json 2>/dev/null); then
  FRONTEND_BUCKET=$(OUTPUTS_JSON="$OUTPUTS_JSON" node -e "
    const outputs = JSON.parse(process.env.OUTPUTS_JSON);
    const found = outputs.find((o) => o.OutputKey === 'FrontendBucketName');
    process.stdout.write(found ? found.OutputValue : '');
  ")
  DATALAKE_BUCKET=$(OUTPUTS_JSON="$OUTPUTS_JSON" node -e "
    const outputs = JSON.parse(process.env.OUTPUTS_JSON);
    const found = outputs.find((o) => o.OutputKey === 'DataLakeBucketName');
    process.stdout.write(found ? found.OutputValue : '');
  ")
  [ -n "${FRONTEND_BUCKET:-}" ] && empty_bucket "$FRONTEND_BUCKET"
  [ -n "${DATALAKE_BUCKET:-}" ] && empty_bucket "$DATALAKE_BUCKET"
else
  echo "==> Stack $STACK_NAME not found -- skipping bucket lookup"
fi

echo "==> Deleting stack $STACK_NAME"
aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"

echo "==> Force-deleting any leftover secrets (CloudFormation soft-deletes Secrets Manager secrets by default, which would block a future deploy.sh from recreating the same secret name)"
SECRET_NAMES=$(aws secretsmanager list-secrets --region "$REGION" \
  --query "SecretList[?starts_with(Name, '${NAME_PREFIX}-')].Name" --output text 2>/dev/null || true)
for name in $SECRET_NAMES; do
  echo "    deleting secret $name"
  aws secretsmanager delete-secret --region "$REGION" --secret-id "$name" --force-delete-without-recovery >/dev/null 2>&1 || true
done

echo "==> Removing the deploy artifacts bucket ($ARTIFACTS_BUCKET)"
empty_bucket "$ARTIFACTS_BUCKET"
aws s3api delete-bucket --bucket "$ARTIFACTS_BUCKET" --region "$REGION" 2>/dev/null || true

rm -f outputs.json frontend/.env.production

echo "==> Destroy complete"

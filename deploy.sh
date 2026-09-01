#!/usr/bin/env bash
# Builds and deploys the Quality Dashboard stack. Idempotent -- safe to
# re-run. Exits non-zero on any failure. See CLAUDE.md for the platform
# contract this script must follow (naming prefix, region, no shared/managed
# bootstrap artifacts, ECR handled outside CloudFormation, etc).
set -euo pipefail
cd "$(dirname "$0")"

NAME_PREFIX="app-79dad50c-0e543650"
REGION="ap-southeast-1"
STACK_NAME="${NAME_PREFIX}-quality-dashboard"
ARTIFACTS_BUCKET="${NAME_PREFIX}-artifacts"

echo "==> Ensuring deploy artifacts bucket exists ($ARTIFACTS_BUCKET)"
if ! aws s3api head-bucket --bucket "$ARTIFACTS_BUCKET" --region "$REGION" 2>/dev/null; then
  aws s3api create-bucket \
    --bucket "$ARTIFACTS_BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

echo "==> Installing root (test/tooling) dependencies"
npm install

echo "==> Running backend test suite"
npm test

echo "==> sam build"
sam build

echo "==> sam deploy"
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --s3-bucket "$ARTIFACTS_BUCKET" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

echo "==> Reading stack outputs"
OUTPUTS_JSON=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output json)

get_output() {
  OUTPUTS_JSON="$OUTPUTS_JSON" KEY="$1" node -e "
    const outputs = JSON.parse(process.env.OUTPUTS_JSON);
    const found = outputs.find((o) => o.OutputKey === process.env.KEY);
    process.stdout.write(found ? found.OutputValue : '');
  "
}

API_URL=$(get_output ApiUrl)
FRONTEND_BUCKET=$(get_output FrontendBucketName)
USER_POOL_ID=$(get_output UserPoolId)
USER_POOL_CLIENT_ID=$(get_output UserPoolClientId)
DB_ENDPOINT=$(get_output DbEndpoint)
DB_SECRET_ARN=$(get_output DbSecretArn)
CDN_DISTRIBUTION_ID=$(get_output CdnDistributionId)

echo "==> Running DB migrations"
DB_HOST="$DB_ENDPOINT" DB_SECRET_ARN="$DB_SECRET_ARN" AWS_REGION="$REGION" node scripts/migrate.js

echo "==> Configuring frontend build"
cat > frontend/.env.production <<EOF
VITE_API_URL=$API_URL
VITE_USER_POOL_ID=$USER_POOL_ID
VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
VITE_REGION=$REGION
EOF

echo "==> Installing frontend dependencies"
npm --prefix frontend install

echo "==> Running frontend test suite"
npm run test:frontend

echo "==> Building frontend"
npm run build:frontend

echo "==> Publishing frontend to S3 ($FRONTEND_BUCKET)"
aws s3 sync frontend/dist "s3://$FRONTEND_BUCKET" --delete --region "$REGION"

if [ -n "$CDN_DISTRIBUTION_ID" ]; then
  echo "==> Invalidating CloudFront cache ($CDN_DISTRIBUTION_ID)"
  aws cloudfront create-invalidation --distribution-id "$CDN_DISTRIBUTION_ID" --paths '/*' >/dev/null
fi

echo "==> Writing outputs.json"
OUTPUTS_JSON="$OUTPUTS_JSON" node -e "
  const outputs = JSON.parse(process.env.OUTPUTS_JSON);
  const obj = {};
  for (const o of outputs) obj[o.OutputKey] = o.OutputValue;
  obj.app_url = obj.AppUrl;
  require('fs').writeFileSync('outputs.json', JSON.stringify(obj, null, 2));
"

echo "==> Deploy complete"
cat outputs.json

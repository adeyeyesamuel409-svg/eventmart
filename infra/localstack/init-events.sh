#!/bin/sh
set -e

AWS="aws --endpoint-url http://localstack:4566"
ACCOUNT=000000000000

echo "waiting for localstack..."
for i in $(seq 1 30); do
  if $AWS sqs list-queues >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

ORDERS_TOPIC=$($AWS sns create-topic --name eventmart-orders --query TopicArn --output text)
PAYMENTS_TOPIC=$($AWS sns create-topic --name eventmart-payments --query TopicArn --output text)

for q in eventmart-payments-svc eventmart-catalog-svc eventmart-notifications-svc eventmart-orders-svc; do
  $AWS sqs create-queue --queue-name "$q" >/dev/null
done

subscribe() {
  topic=$1
  queue=$2
  filter=$3
  queue_arn=$($AWS sqs get-queue-attributes --queue-url "http://localstack:4566/$ACCOUNT/$queue" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
  sub=$($AWS sns subscribe --topic-arn "$topic" --protocol sqs --notification-endpoint "$queue_arn" --attributes RawMessageDelivery=true --query SubscriptionArn --output text)
  $AWS sns set-subscription-attributes --subscription-arn "$sub" --attribute-name FilterPolicy --attribute-value "$filter"
  echo "subscribed $queue to $topic ($filter)"
}

subscribe "$ORDERS_TOPIC" eventmart-payments-svc '{"event-type":["order.placed"]}'
subscribe "$ORDERS_TOPIC" eventmart-catalog-svc '{"event-type":["order.placed"]}'
subscribe "$ORDERS_TOPIC" eventmart-notifications-svc '{"event-type":["order.placed"]}'
subscribe "$PAYMENTS_TOPIC" eventmart-notifications-svc '{"event-type":["payment.succeeded","payment.failed"]}'
subscribe "$PAYMENTS_TOPIC" eventmart-orders-svc '{"event-type":["payment.succeeded","payment.failed"]}'

echo "local SNS/SQS topology ready"

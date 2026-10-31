const { randomUUID } = require("node:crypto");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");

const sns = new SNSClient({});
const sqs = new SQSClient({});

async function publishEvent(topicArn, eventType, data) {
  const event = {
    eventType,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    data,
  };
  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(event),
      MessageAttributes: { "event-type": { DataType: "String", StringValue: eventType } },
    })
  );
  return event;
}

function unwrap(rawBody) {
  const body = JSON.parse(rawBody);
  if (body && body.Type === "Notification" && typeof body.Message === "string") {
    return JSON.parse(body.Message);
  }
  return body;
}

function startEventConsumer(queueUrl, handler) {
  async function poll() {
    for (;;) {
      try {
        const { Messages } = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 10,
            VisibilityTimeout: 60,
          })
        );
        if (!Messages) continue;
        for (const message of Messages) {
          try {
            await handler(unwrap(message.Body));
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
          } catch (err) {
            console.error("event handler failed, message will be retried", err);
          }
        }
      } catch (err) {
        console.error("event poll failed", err);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  poll();
}

module.exports = { publishEvent, startEventConsumer };

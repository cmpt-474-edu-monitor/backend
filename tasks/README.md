# Task Microservice

**NOTE: When adding a task `classroom`,`student`,`addedBy` are hard coded since the microservice hasn't been integrated with `Users` or `Grades`**

## 1. Create `Tasks` Table

In your AWS console, go to **DynamoDB**. Select **Create table**.

- Table Name: Tasks
- Primary Key: id (string)

## 2. Create Lambda Function

#### 1.1 Lambda Function

In your AWS console, go to **Lambda**. Select **Create function**.

- Function Name: EduMonitor_Tasks
- Runtime: Node.js 14x
- Leave everything else as default

Zip the code found in `backend\tasks` found in the `tasks-iteration1` branch.
Upload the zip to the lambda function.

#### 1.2 Add Inline Policy

This is done to allow the Lambda function access to DynamoDB.

In the `EduMonitor_Tasks` function go to **Configuration**, then select **Permissions** on the menu on the left sidebar.

Under **Execution Role** select the role which will bring you to a new window.

Click **Add Inline Policy**. Copy the following JSON :

**NOTE: replace the table ARN with the table you have created**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisualEditor0",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan",
        "dynamodb:Query",
        "dynamodb:UpdateItem"
      ],
      "Resource": "YOUR-TABLE-ARN"
    }
  ]
}
```

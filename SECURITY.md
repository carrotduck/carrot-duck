# Security and test data

This is a research prototype. The default local server listens on `127.0.0.1`, background jobs are disabled, and administrative access requires a configured secret. These defaults do not replace a deployment review.

Use synthetic experiences when trying the demo. Never commit `.env`, API keys, recovery keys, session tokens, databases, conversation exports or uploaded media. Provider requests can include the current message, selected memories and recent dialogue. Keep that data handling in mind when configuring an external model service.

To report a suspected vulnerability, use the contact address on [Shirui Fu's website](https://shiruifu.online/). Describe the affected component and reproduction steps using synthetic data. Do not post private conversations or working credentials in a public issue.

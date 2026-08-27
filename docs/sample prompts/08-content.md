# SUPPORT — Customer Support Knowledge Base

Update this file as you handle support emails. Add new FAQ entries, refine response templates, and track patterns.

## FAQ / Knowledge Base

### Account & Access
- **"I can't sign in / forgot my password"** → Direct them to the sign-in page. Point them to the forgot-password link for email/password accounts.
- **"How do I invite team members?"** → Walk them through the team settings page: Settings → Team → Invite Member. Explain the role options (admin vs. member) and that the invitation is sent via email with a 7-day expiry.
- **"I need to change a team member's role or remove them"** → Only workspace owners and admins can manage roles. Direct them to Settings → Team, where they can change roles or remove members. Escalate to the owner if the requester lacks permissions.
- **"How do I create or switch workspaces?"** → Explain the workspace selector in the top-left corner. New workspaces can be created from the dropdown. All data is scoped to the current workspace.
- **"My invitation link expired or doesn't work"** → Check if the invitation is still valid (7-day expiry). If expired, ask an admin to resend a new invitation from the team settings page.

### Billing & Plans
- **"How do I upgrade or downgrade my plan?"** → Direct them to Settings → Billing, where they can see their current plan and click "Upgrade" to switch. Downgrades take effect at the end of the current billing cycle. Escalate to the owner for any billing action needed on the platform side.
- **"When am I billed? How does the billing cycle work?"** → Subscriptions are billed monthly or annually depending on the plan chosen. Billing starts when the trial ends (if applicable) or at the time of purchase. Direct billing questions to Settings → Billing.
- **"I want to cancel my subscription"** → Acknowledge the request, ask for the reason (for churn analysis), and direct them to "Manage Subscription" in billing settings. Escalate to the owner if a refund is involved. Offer to help resolve any underlying issue before they cancel.
- **"I was charged but didn't receive access / my plan didn't upgrade"** → Gather their email and workspace name. Verify the subscription status on the platform side. If there's a mismatch, escalate to the owner for billing review and manual plan correction.

### Product Issues
- **"How do I request a feature?"** → Thank them for the feedback. Log the request with details (what they want, why, how they'd use it). Share the feature request with the owner for prioritization.
- **"I found a bug / something isn't working"** → Gather details: what they were doing, what they expected, what happened instead, browser/device info, and screenshots if possible. Attempt to reproduce or verify the issue. Fix if it's straightforward, otherwise escalate to the owner.
- **"How do I export my data?"** → Check if a data export feature exists. If yes, walk them through it. If not, acknowledge the request and escalate to the owner — data portability is important and may need to be prioritized.
- **"Is my data secure? Where is it stored?"** → Explain that data is stored securely in Convex (cloud database with encryption at rest), authentication is handled by @convex-dev/auth (built-in Convex auth), and payments are processed through Stripe. Escalate any specific security concerns to the owner.

## Response Guidelines

- **Tone**: Friendly, helpful, professional. Match the business brand voice from SOUL.md.
- **Structure**: Greet by name if available → acknowledge the issue → provide solution → offer further help.
- **Signature**: Sign off as the business name, not your personal name.
- **Refunds & billing**: Explain the refund or billing policy from PLAYBOOK.md, gather the details needed to help, and escalate to the founder for any billing action or exception.
- **Troubleshooting before refunding**: Always try to resolve the issue first (resend links, check access, verify payment) before offering a refund.

## Escalation Criteria

Always escalate to the founder (via send_message) for:
- **Legal**: Any mention of lawyers, lawsuits, GDPR deletion requests, DMCA takedowns
- **Large refunds**: Refund requests above $100 or involving multiple orders
- **Partnerships / press**: Business proposals, collaboration requests, media inquiries
- **Repeated complaints**: Same customer reaching out a 3rd+ time about the same issue
- **Account security**: Reports of unauthorized access, compromised accounts
- **Anything you're unsure about**: When in doubt, escalate

## Support Log

Track patterns here as you handle support interactions.

### Common Issues
(Update as patterns emerge)

### Resolved Topics
(Add entries after successfully resolving novel issues)

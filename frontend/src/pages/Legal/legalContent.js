// Template legal documents for Nexara.
//
// THIS IS A STARTING POINT, NOT LEGAL ADVICE. A live deployment
// must replace every [[BRACKETED]] placeholder with real operator
// details and have the documents reviewed by qualified legal
// counsel in the jurisdiction where Nexara operates. Once every
// [[...]] placeholder is replaced, the "template" notice in the
// legal page UI disappears automatically.

const UPDATED = "September 17, 2026";

export const privacyDocument = {
    title: "Privacy Policy",
    updated: UPDATED,
    intro:
        "This Privacy Policy explains what Nexara collect, why we collect it, " +
        "and how you can exercise control over your information. Nexara is " +
        "an end-to-end encrypted messaging platform: your messages, calls, " +
        "media, and keys are encrypted on your device, and (as described " +
        "below) cannot be read by us.",
    sections: [
        {
            heading: "Operator",
            body: [
                "Nexara is operated by [[OPERATOR_NAME]], [[OPERATOR_ADDRESS]] " +
                "(\u201Cwe\u201D, \u201Cus\u201D, \u201Cour\u201D). You can contact us " +
                "about this policy at cipherchat.dev@gmail.com.",
            ],
        },
        {
            heading: "What we collect",
            body: [
                "Account basics: your email address (used for one-time-code " +
                "login and account recovery), your chosen username, and any " +
                "profile information you choose to add.",
                "Encryption material: your public identity and prekeys, which " +
                "are required for the Signal-protocol handshake. We never see " +
                "your private keys.",
                "Content in ciphertext: your encrypted messages, attachments, " +
                "avatars, stories, and cross-device sync envelopes. Because " +
                "everything is encrypted on your device, we cannot read or " +
                "monetize this content.",
                "Metadata needed to operate the service: timestamps, " +
                "conversation membership, delivery/read receipts, and device " +
                "registration records.",
                "Technical data: connection logs used for abuse prevention and " +
                "rate limiting, push-subscription tokens, and (where enabled) " +
                "anonymized telemetry and error reports.",
            ],
        },
        {
            heading: "How we use your information",
            body: [
                "To provide the service: authenticate you, route encrypted " +
                "messages between your devices and contacts, store ciphertext " +
                "you ask us to, and deliver push notifications.",
                "To keep the service safe: prevent abuse, spam, and attacks; " +
                "enforce rate limits; and respond to security incidents.",
                "To comply with law and to exercise or defend legal claims.",
                "We do not sell your personal information, and we do not use " +
                "message content or plaintext for advertising.",
            ],
        },
        {
            heading: "Who we share with",
            body: [
                "We share information only with service providers who help us " +
                "operate Nexara (hosting, email delivery, push delivery) under " +
                "contracts that bound their use of the data, and with " +
                "authorities only where we are legally required to.",
            ],
        },
        {
            heading: "Retention",
            body: [
                "Messages and attachments remain stored until you (or the " +
                "recipient account) delete them, unless a shorter rule applies.",
                "Disappearing and view-once messages are engineered to be " +
                "hard-deleted server-side shortly after they expire, and the " +
                "associated files are swept from disk.",
                "Stories are removed after 24 hours by design.",
                "Account deletion (Settings \u2192 Account \u2192 Delete application) " +
                "removes the account\u2019s server-side records and ciphertext, " +
                "subject to legal hold obligations.",
            ],
        },
        {
            heading: "How we protect your information",
            body: [
                "End-to-end encryption: your conversations cannot be read by us.",
                "Access tokens are held in memory on your device, never in " +
                "storage; refresh tokens are HttpOnly cookies that rotate on use.",
                "Server-side security: hardened TLS, row-level security on the " +
                "database, rate limiting, and strict upload validation.",
                "Independent code review is encouraged: the platform is " +
                "open-source and we welcome responsible disclosure of " +
                "vulnerabilities.",
            ],
        },
        {
            heading: "Your rights",
            body: [
                "Depending on your jurisdiction (e.g. GDPR in the EEA/UK, " +
                "CCPA/CPRA in California), you may have rights to access, " +
                "correct, export, restrict, object to, or delete your personal " +
                "information.",
                "You can export and delete your data through the app: your " +
                "recovery code unlocks the synced session material, and " +
                "account deletion removes your account permanently.",
                "To exercise a right or raise a concern, contact us at " +
                "cipherchat.dev@gmail.com. You may also have the right to lodge a " +
                "complaint with your data-protection authority.",
            ],
        },
        {
            heading: "Cookies and local storage",
            body: [
                "Nexara uses an HttpOnly refresh-token cookie and browser " +
                "local storage for session state and preferences. We do not use " +
                "third-party tracking cookies or advertising identifiers.",
            ],
        },
        {
            heading: "Children",
            body: [
                "Nexara is not directed at children under the age of " +
                "16. If you believe a person under that age has created " +
                "an account, contact us at cipherchat.dev@gmail.com.",
            ],
        },
        {
            heading: "Changes",
            body: [
                "We may update this policy as the service evolves. Material " +
                "changes will be reflected by a new \u201CLast updated\u201D date " +
                "and, where practical, a notice in the app.",
            ],
        },
        {
            heading: "Contact",
            body: [
                "Questions about this policy: cipherchat.dev@gmail.com.",
            ],
        },
    ],
};

export const termsDocument = {
    title: "Terms of Service",
    updated: UPDATED,
    intro:
        "These Terms of Service (\u201CTerms\u201D) govern your use of Nexara, an " +
        "end-to-end encrypted messaging platform operated by [[OPERATOR_NAME]] " +
        "(\u201Cwe\u201D, \u201Cus\u201D). By creating an account or using the " +
        "service, you agree to these Terms.",
    sections: [
        {
            heading: "The service",
            body: [
                "Nexara provides encrypted messaging, group conversations, media " +
                "sharing, stories, and voice/video calls. Encrypted content is " +
                "delivered and stored on your behalf; we do not have access to " +
                "the plaintext.",
                "The service is provided as-is and as-available, without " +
                "warranties of uninterrupted or error-free operation.",
            ],
        },
        {
            heading: "Your account",
            body: [
                "You are responsible for keeping your account credentials and " +
                "recovery code safe. Your recovery code is the only way to " +
                "restore synced history on a new device; because the data is " +
                "encrypted to your keys, we cannot reset it on your behalf.",
                "Accounts are personal and are not to be transferred or used " +
                "by someone other than the registered user.",
                "You must be at least 16 years old to use Nexara.",
            ],
        },
        {
            heading: "Acceptable use",
            body: [
                "You agree not to use Nexara for unlawful activity, " +
                "harassment, child sexual abuse material, spam, malware, or to " +
                "infringe the rights of others.",
                "You agree not to disrupt the service, attempt to bypass " +
                "security or encryption controls, or scrape or mass-harvest " +
                "user data.",
            ],
        },
        {
            heading: "Your content",
            body: [
                "You retain ownership of the content you create and share. You " +
                "grant us the limited rights needed to store, transmit, and " +
                "display it as part of providing the service.",
                "Encryption is designed so that you-created content is readable " +
                "only by the recipients you choose.",
            ],
        },
        {
            heading: "Termination",
            body: [
                "You may delete your account at any time from Settings; this " +
                "removes your server-side records and encrypted content.",
                "We may suspend or terminate accounts that violate these Terms " +
                "or that pose a legal or security risk to the service or other " +
                "users.",
            ],
        },
        {
            heading: "Intellectual property",
            body: [
                "The Nexara name, logo, and website are owned by " +
                "[[OPERATOR_NAME]]. The software is released under the MIT " +
                "license.",
            ],
        },
        {
            heading: "Disclaimers and limitation of liability",
            body: [
                "To the maximum extent permitted by law, the service is provided " +
                "\u201Cas is\u201D without warranties of any kind, and we are not " +
                "liable for indirect, incidental, special, or consequential " +
                "damages arising from your use of the service.",
                "Nothing in these Terms limits liability that cannot be limited " +
                "by applicable law or our obligations under consumer-protection " +
                "statutes.",
            ],
        },
        {
            heading: "Governing law and disputes",
            body: [
                "These Terms are governed by the laws of India, " +
                "without regard to conflict-of-law rules.",
                "We encourage you to contact cipherchat.dev@gmail.com before starting " +
                "any formal proceeding so we can resolve the matter directly.",
            ],
        },
        {
            heading: "Changes",
            body: [
                "We may revise these Terms from time to time; the \u201CLast " +
                "updated\u201D date above reflects the latest version. Continued " +
                "use of the service after changes take effect constitutes " +
                "acceptance of the revised Terms.",
            ],
        },
        {
            heading: "Contact",
            body: [
                "Questions about these Terms: cipherchat.dev@gmail.com.",
            ],
        },
    ],
};

export const TEMPLATE_TOKEN = /\[\[[A-Z_]+\]\]/g;
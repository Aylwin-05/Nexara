import { Link } from "react-router-dom";

import SidebarShell from "../../components/layout/SidebarShell";
import { useAuth } from "../../context/AuthContext";

import {
    privacyDocument,
    TEMPLATE_TOKEN,
    termsDocument,
} from "./legalContent";

import "./Legal.css";

const DOCS = {
    privacy: privacyDocument,
    terms: termsDocument,
};

function LegalContent({ document, isTemplate, isAuthenticated }) {
    return (
        <div className="legal-content">

            <Link
                className="legal-back"
                to={isAuthenticated ? "/settings" : "/login"}
            >
                ← Back
            </Link>

            {isTemplate && (
                <div className="legal-notice" role="note">
                    <strong>Template notice:</strong> this document still
                    contains <code>[[BRACKETED]]</code> placeholders
                    (operator name, address, contact, jurisdiction, age
                    limit). Replace them with the real operator details and
                    have this reviewed by qualified legal counsel before
                    going live. It is provided as a starting point only and
                    is not legal advice.
                </div>
            )}

            <h1>{document.title}</h1>

            {document.updated && (
                <p className="legal-updated">
                    Last updated: {document.updated}
                </p>
            )}

            <p className="legal-intro">
                {document.intro}
            </p>

            {document.sections.map((section) => (
                <section key={section.heading}>
                    <h2>{section.heading}</h2>
                    {section.body.map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                    ))}
                </section>
            ))}

        </div>
    );
}

export default function LegalPage({ doc }) {
    const { isAuthenticated } = useAuth();
    const document = DOCS[doc];
    const isTemplate = TEMPLATE_TOKEN.test(document.intro) ||
        document.sections.some((section) =>
            section.body.some((paragraph) => TEMPLATE_TOKEN.test(paragraph))
        );

    if (isAuthenticated) {
        return (
            <SidebarShell currentPage="settings">
                <div className="legal-page">
                    <LegalContent
                        document={document}
                        isTemplate={isTemplate}
                        isAuthenticated
                    />
                </div>
            </SidebarShell>
        );
    }

    return (
        <div className="legal-page">
            <LegalContent
                document={document}
                isTemplate={isTemplate}
                isAuthenticated={false}
            />
        </div>
    );
}
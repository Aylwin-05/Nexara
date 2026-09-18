import { Component } from "react";

export default class ErrorBoundary extends Component {

    constructor(props) {

        super(props);

        this.state = { hasError: false, error: null, errorInfo: null };

    }

    static getDerivedStateFromError(error) {

        return { hasError: true, error };

    }

    componentDidCatch(error, info) {

        console.error(
            "Unhandled UI error:",
            error,
            info,
        );

        this.setState({ errorInfo: info });

    }

    render() {

        if (this.state.hasError) {

            const msg =
                this.state.error?.message ?? "Unknown error";

            const stack =
                this.state.errorInfo?.componentStack ?? "";

            return (

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: "100vh",
                        gap: "12px",
                        fontFamily: "sans-serif",
                        padding: "24px",
                        maxWidth: "600px",
                        margin: "0 auto",
                    }}
                >
                    <h2>Something went wrong.</h2>
                    <p style={{ color: "#666", textAlign: "center" }}>
                        {msg}
                    </p>
                    {stack && (
                        <pre
                            style={{
                                fontSize: "11px",
                                background: "#f5f5f5",
                                padding: "12px",
                                borderRadius: "6px",
                                overflow: "auto",
                                maxHeight: "200px",
                                width: "100%",
                                whiteSpace: "pre-wrap",
                            }}
                        >
                            {stack}
                        </pre>
                    )}
                    <button
                        onClick={() =>
                            window.location.reload()
                        }
                    >
                        Reload
                    </button>
                </div>
            );

        }

        return this.props.children;

    }

}
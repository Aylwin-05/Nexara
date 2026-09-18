import "./Skeleton.css";

export function SkeletonLine({ width = "100%", height = "1em", style }) {
    return (
        <div
            className="skeleton"
            style={{
                width,
                height,
                ...style,
            }}
        />
    );
}

export function SkeletonCircle({ size = 40, style }) {
    return (
        <div
            className="skeleton"
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                flexShrink: 0,
                ...style,
            }}
        />
    );
}

export function SkeletonMessage() {
    return (
        <div className="skeleton-msg">
            <SkeletonCircle size={32} />
            <div className="skeleton-msg-lines">
                <SkeletonLine width="45%" height="10px" />
                <SkeletonLine width="80%" height="10px" />
                <SkeletonLine width="30%" height="10px" />
            </div>
        </div>
    );
}

export function SkeletonConversation() {
    return (
        <div className="skeleton-conv">
            <SkeletonCircle size={44} />
            <div className="skeleton-conv-lines">
                <SkeletonLine width="60%" height="12px" />
                <SkeletonLine width="85%" height="10px" />
            </div>
        </div>
    );
}

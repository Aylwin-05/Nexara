import { useEffect, useRef, useState } from "react";

import Sidebar from "../../components/layout/Sidebar";

import MobileTabBar from "../../components/mobile/MobileTabBar";

import ConversationList from "../../components/chat/ConversationList";
import ChatWindow from "../../components/chat/ChatWindow";
import StatusPage from "../../components/story/StatusPage";
import FriendsPage from "../../components/friends/FriendsPage";
import CallLog from "../../components/call/CallLog";
import SettingsPage from "../Settings/SettingsPage";
import DeleteConversationModal from "../../components/chat/DeleteConversationModal";
import RecoveryModal from "../../components/recovery/RecoveryModal";
import LockScreen from "../../components/lock/LockScreen";

import conversationService from "../../services/conversationService";

import appLock from "../../utils/appLock";
import { useAndroidBack } from "../../utils/androidBack";
import useScreenSecurity from "../../hooks/useScreenSecurity";

import { useAuth } from "../../context/AuthContext";
import {
    ChatSocketProvider,
    useChatSocket,
} from "../../context/ChatSocketContext";
import { CallProvider } from "../../context/CallContext";

import "./Dashboard.css";

// WhatsApp-style horizontal page order for the swipe tab slider.
// Mirrors the MobileTabBar tab order so a tab tap and a swipe
// always land on the same index.
const SWIPE_ORDER = [
    "chats",
    "status",
    "friends",
    "calls",
    "settings",
];

const SWIPE_BREAKPOINT = "(max-width: 720px)";

// Compile the mobile media query once; the slider only renders
// (and swipe handling only exists) below the tab-bar breakpoint,
// where the bottom bar replaces the desktop rail.
function useMediaQuery(query) {

    const [matches, setMatches] =
        useState(() =>
            window.matchMedia(query).matches
        );

    useEffect(() => {

        const mql = window.matchMedia(query);

        const onChange = () =>
            setMatches(mql.matches);

        mql.addEventListener("change", onChange);

        return () =>
            mql.removeEventListener("change", onChange);

    }, [query]);

    return matches;

}

export default function Dashboard() {

    return (

        <ChatSocketProvider>

            <CallProvider>

                <DashboardInner />

            </CallProvider>

        </ChatSocketProvider>

    );

}

function DashboardInner() {

    const {
        user,
        recoveryCode,
        needsRecoveryEntry,
        dismissRecoveryEntry,
    } = useAuth();

    const {
        conversations,
        loading,
        activeConversationId,
        selectConversation,
        refreshConversations,
    } = useChatSocket();

    const screenSecurity = useScreenSecurity();

    const [
        currentPage,
        setCurrentPage,
    ] = useState("chats");

    // Android back button fallback: if the user is on a
    // secondary tab (status / friends / settings), send them
    // back to the chats tab. Returning false at the chats tab
    // lets androidBack.js exit the app.
    useAndroidBack(() => {

        if (currentPage !== "chats") {
            setCurrentPage("chats");
            return true;
        }

        return false;

    }, currentPage !== "chats");

    //------------------------------------------------------
    // WhatsApp-style page slider (mobile only)
    //
    // On phones the Dashboard is a row of full-width pages
    // that slide horizontally. The drag is recognized in JS
    // on the slider wrapper (pointer events with a touch
    // fallback and `touch-action: pan-y`), so a swipe works
    // from ANY touch point on the page while vertical lists
    // and taps pass straight through untouched. Bottom-bar
    // taps use the same fast transform animation. Desktop
    // keeps the single-page stage (no slide).
    //------------------------------------------------------

    const isMobile =
        useMediaQuery(SWIPE_BREAKPOINT);

    const slideIndex = Math.max(
        0,
        SWIPE_ORDER.indexOf(currentPage),
    );

    const sliderRef = useRef(null);

    const gestureRef = useRef({
        active: false,
        mode: "",          // "pointer" | "touch"
        startX: 0,
        startY: 0,
        baseIndex: 0,
        dx: 0,
        dragging: false,
        suppressClick: false,
    });

    const [dragOffset, setDragOffset] =
        useState(0);

    const [isDragging, setIsDragging] =
        useState(false);

    // First non-horizontal event wins the gesture; the other
    // input family backs off so they never double-drive.
    function beginGesture(mode, x, y) {

        const g = gestureRef.current;

        if (g.active) return;

        g.active = true;

        g.mode = mode;

        g.startX = x;

        g.startY = y;

        g.baseIndex = slideIndex;

        g.dx = 0;

        g.dragging = false;

        g.suppressClick = false;

    }

    function onGlobalMove(x, y) {

        const g = gestureRef.current;

        if (!g.active) return;

        const dx = x - g.startX;

        const dy = y - g.startY;

        // Not a horizontal drag: it's a tap or a vertical
        // scroll of a list — leave the page alone entirely.
        if (
            !g.dragging &&
            (
                Math.abs(dx) < 12 ||
                Math.abs(dx) <= Math.abs(dy)
            )
        ) {

            return;

        }

        if (!g.dragging) {

            g.dragging = true;

            g.suppressClick = true;

            setIsDragging(true);

        }

        g.dx = dx;

        setDragOffset(dx);

    }

    function endGesture() {

        const g = gestureRef.current;

        if (!g.active) return;

        detachGlobalHandlers();

        if (g.dragging) {

            const width =
                sliderRef.current?.clientWidth ?? 400;

            const direction =
                g.dx < -width * 0.16
                    ? 1
                    : g.dx > width * 0.16
                        ? -1
                        : 0;

            const target = Math.max(
                0,
                Math.min(
                    SWIPE_ORDER.length - 1,
                    g.baseIndex + direction,
                ),
            );

            setCurrentPage(SWIPE_ORDER[target]);

        }

        g.active = false;

        g.dragging = false;

        g.suppressClick = false;

        setDragOffset(0);

        setIsDragging(false);

    }

    const toPointerMove =
        (event) => onGlobalMove(
            event.clientX,
            event.clientY,
        );

    const toPointerEnd =
        () => endGesture();

    const toTouchMove = (event) => {

        const touch = event.touches[0];

        if (touch) onGlobalMove(
            touch.clientX,
            touch.clientY,
        );

        // Once a horizontal drag is confirmed, stop the
        // browser's scroll machinery (vertical lists etc.)
        // from fighting the slider.
        if (gestureRef.current.dragging) {

            event.preventDefault();

        }

    };

    const toTouchEnd = () => endGesture();

    // The window-level listeners are created at attach time and
    // kept here so teardown can remove the EXACT references —
    // the handler functions above are recreated every render.
    const globalHandlersRef = useRef(null);

    function attachGlobalHandlers(mode) {

        if (mode === "pointer") {

            const handlers = {
                mode,
                up: toPointerEnd,
                cancel: toPointerEnd,
                move: toPointerMove,
            };

            globalHandlersRef.current = handlers;

            window.addEventListener(
                "pointermove",
                handlers.move,
            );

            window.addEventListener(
                "pointerup",
                handlers.up,
            );

            window.addEventListener(
                "pointercancel",
                handlers.cancel,
            );

            return;

        }

        const handlers = {
            mode,
            up: toTouchEnd,
            cancel: toTouchEnd,
            move: toTouchMove,
        };

        globalHandlersRef.current = handlers;

        window.addEventListener(
            "touchmove",
            handlers.move,
            { passive: false },
        );

        window.addEventListener(
            "touchend",
            handlers.up,
        );

        window.addEventListener(
            "touchcancel",
            handlers.cancel,
        );

    }

    function detachGlobalHandlers() {

        const handlers = globalHandlersRef.current;

        if (!handlers) return;

        globalHandlersRef.current = null;

        window.removeEventListener(
            `${handlers.mode}move`,
            handlers.move,
        );

        window.removeEventListener(
            `${handlers.mode}up`,
            handlers.up,
        );

        window.removeEventListener(
            `${handlers.mode}cancel`,
            handlers.cancel,
        );

    }

    function handleSliderPointerDown(event) {

        if (event.button !== 0) return;

        beginGesture(
            "pointer",
            event.clientX,
            event.clientY,
        );

        attachGlobalHandlers("pointer");

    }

    function handleSliderTouchStart(event) {

        const touch = event.touches[0];

        if (!touch) return;

        beginGesture(
            "touch",
            touch.clientX,
            touch.clientY,
        );

        attachGlobalHandlers("touch");

    }

    // The native click still fires after a drag ends over a
    // tappable row — swallow it so a swipe never also opens
    // whatever happened to be under the finger.
    function handleSliderClickCapture(event) {

        if (gestureRef.current.suppressClick) {

            event.preventDefault();

            event.stopPropagation();

            gestureRef.current.suppressClick = false;

        }

    }

    useEffect(() => () => {

        detachGlobalHandlers();

    }, []);

    // Edge rubber-band: the first/last page resists being
    // pulled past its bounds.
    function trackOffset() {

        let px = dragOffset;

        const last = SWIPE_ORDER.length - 1;

        if (
            (slideIndex === 0 && px > 0) ||
            (slideIndex === last && px < 0)
        ) {

            px *= 0.22;

        }

        return px;

    }

    //------------------------------------------------------
    // App lock (local PIN gate). When configured, the app
    // stays locked until the PIN is entered in this tab.
    // The check is async (IndexedDB), so it resolves in an
    // effect instead of the state initializer.
    //------------------------------------------------------

    const [appLocked, setAppLocked] = useState(false);

    useEffect(() => {

        let cancelled = false;

        appLock.isConfigured()
            .then(configured => {

                if (
                    !cancelled &&
                    configured &&
                    !appLock.isUnlocked()
                ) {
                    setAppLocked(true);
                }

            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };

    }, []);

    //------------------------------------------------------
    // Incoming two-party delete request: auto-open the
    // confirmation popup when someone wants to wipe a chat.
    // Each pending request prompts exactly once (keyed by
    // its id + timestamp) until it is resolved or replaced.
    //------------------------------------------------------

    const [pendingDeletePrompt, setPendingDeletePrompt] =
        useState(null);

    const promptSeenRef = useRef(null);

    useEffect(() => {

        if (!user) return;

        const incoming = conversations.find(conv =>

            conv.delete_requested_by &&
            conv.delete_requested_by !== user.id

        );

        if (!incoming) {

            setPendingDeletePrompt(null);

            return;

        }

        const key =
            `${incoming.id}:${incoming.delete_requested_at ?? ""}`;

        if (promptSeenRef.current === key) return;

        promptSeenRef.current = key;

        setPendingDeletePrompt(incoming);

    }, [conversations, user]);

    const selectedConversation =
        conversations.find(
            conversation =>
                conversation.id ===
                activeConversationId
        ) ?? null;

    //----------------------------------------------------------
    // Select conversation (clears its unread badge)
    //----------------------------------------------------------

    function handleSelectConversation(conversation) {

        selectConversation(conversation.id);

    }

    //----------------------------------------------------------
    // Start Chat
    //----------------------------------------------------------

    async function handleStartChat(friend) {

        try {

            //--------------------------------------------------
            // Find the other user
            //--------------------------------------------------

            const targetUser =

                friend.sender.id === user.id

                    ? friend.receiver

                    : friend.sender;

            //--------------------------------------------------
            // Create/Open conversation
            //--------------------------------------------------

            const openedConversation =

                await conversationService.createPrivateConversation(

                    targetUser.id

                );

            //--------------------------------------------------
            // Reload conversations
            //--------------------------------------------------

            await refreshConversations();

            //--------------------------------------------------
            // Select opened conversation
            //--------------------------------------------------

            selectConversation(
                openedConversation.id
            );

            //--------------------------------------------------
            // Switch to Chats
            //--------------------------------------------------

            setCurrentPage("chats");

        }

        catch (error) {

            console.error(
                "Unable to open conversation",
                error
            );

        }

    }

    //----------------------------------------------------------
    // Group created: refresh the sidebar and open the chat
    //----------------------------------------------------------

    async function handleGroupCreated(group) {

        try {

            await refreshConversations();

            selectConversation(group.id);

        }
        catch (error) {

            console.error(
                "Unable to refresh after group creation",
                error
            );

        }

    }

    //----------------------------------------------------------
    // Left a group: drop it from the sidebar and close the chat
    //----------------------------------------------------------

    async function handleLeaveGroup() {

        try {

            await refreshConversations();

            selectConversation(null);

        }
        catch (error) {

            console.error(
                "Unable to refresh after leaving group",
                error
            );

        }

    }

    //----------------------------------------------------------
    // One stage per page key, shared by the desktop single-page
    // stage and the mobile sliding track.
    //----------------------------------------------------------

    function renderPage(page) {

        switch (page) {

            case "friends":

                return (
                    <div className="app-stage friends-stage">
                        <FriendsPage
                            onStartChat={handleStartChat}
                        />
                    </div>
                );

            case "status":

                return (
                    <div className="app-stage status-stage">
                        <StatusPage />
                    </div>
                );

            case "calls":

                return (
                    <div className="app-stage calls-stage">
                        <CallLog
                            onBack={() =>
                                setCurrentPage("chats")
                            }
                        />
                    </div>
                );

            case "settings":

                return (
                    <div className="app-stage settings-stage">
                        <SettingsPage />
                    </div>
                );

            default:

                return (
                    <div className="app-stage">
                        <div className="conv-panel">
                            <ConversationList
                                conversations={conversations}
                                loading={loading}
                                selectedConversation={selectedConversation}
                                onSelectConversation={handleSelectConversation}
                                onGroupCreated={handleGroupCreated}
                                onJoined={handleGroupCreated}
                            />
                        </div>
                        <div className="chat-panel">
                            <ChatWindow
                                conversation={selectedConversation}
                                onLeaveGroup={handleLeaveGroup}
                            />
                        </div>
                    </div>
                );

        }

    }

    return (

        <div
            className={
                activeConversationId
                    ? "app-shell in-chat"
                    : "app-shell"
            }
            data-privacy-blurred={
                screenSecurity.blurred ? "true" : "false"
            }
        >

            {appLocked && (

                <LockScreen
                    onUnlocked={() =>
                        setAppLocked(false)
                    }
                />

            )}

            <Sidebar

                currentPage={currentPage}

                setCurrentPage={setCurrentPage}

            />

{

                isMobile ? (

                    <div
                        ref={sliderRef}
                        className="page-slider"
                        onPointerDown={handleSliderPointerDown}
                        onTouchStart={handleSliderTouchStart}
                        onClickCapture={handleSliderClickCapture}
                    >

                        <div
                            className={
                                isDragging
                                    ? "page-slider-track dragging"
                                    : "page-slider-track"
                            }
                            style={{
                                transform:
                                    `translateX(calc(${-slideIndex * 100}% + ${trackOffset()}px))`,
                            }}
                        >

                            {SWIPE_ORDER.map(page => (
                                <div
                                    key={page}
                                    className="page-slider-page"
                                >
                                    {renderPage(page)}
                                </div>
                            ))}

                        </div>

                    </div>

                ) : renderPage(currentPage)

            }

            {pendingDeletePrompt && (

                <DeleteConversationModal

                    conversation={
                        pendingDeletePrompt
                    }

                    onClose={() =>
                        setPendingDeletePrompt(null)
                    }

                />

            )}

            {recoveryCode && (

                <RecoveryModal mode="show-code" />

            )}

            {!recoveryCode && needsRecoveryEntry && (

                <RecoveryModal
                    mode="enter-code"
                    onGoToSupport={() => {

                        dismissRecoveryEntry();

                        setCurrentPage("settings");

                    }}
                />

            )}

            <MobileTabBar

                currentPage={currentPage}

                setCurrentPage={setCurrentPage}

            />

        </div>

    );

}
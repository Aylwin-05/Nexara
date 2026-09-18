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

                currentPage === "friends"

                    ? (

                        <div className="app-stage friends-stage">

                            <FriendsPage

                                onStartChat={
                                    handleStartChat
                                }

                            />

                        </div>

                    )

                        : currentPage === "status"

                            ? (

                                <div className="app-stage status-stage">

                                    <StatusPage />

                                </div>

                            )

                            : currentPage === "calls"

                                ? (

                                    <div className="app-stage calls-stage">

                                        <CallLog

                                            onBack={() =>
                                                setCurrentPage("chats")
                                            }

                                        />

                                    </div>

                                )

                                : currentPage === "settings"

                            ? (

                                <div className="app-stage settings-stage">

                                    <SettingsPage />

                                </div>

                            )

                            : (

                        <div className="app-stage">

                            <div className="conv-panel">

                                <ConversationList

                                    conversations={
                                        conversations
                                    }

                                    loading={
                                        loading
                                    }

                                    selectedConversation={
                                        selectedConversation
                                    }

                                    onSelectConversation={
                                        handleSelectConversation
                                    }

                                    onGroupCreated={
                                        handleGroupCreated
                                    }

                                    onJoined={
                                        handleGroupCreated
                                    }

                                />

                            </div>

                            <div className="chat-panel">

                                <ChatWindow

                                    conversation={
                                        selectedConversation
                                    }

                                    onLeaveGroup={
                                        handleLeaveGroup
                                    }

                                />

                            </div>

                        </div>

                    )

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
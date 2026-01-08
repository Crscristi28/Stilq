/**
 * Chat Cleanup Handler
 * Triggered when a chat document is deleted
 * Cleans up: messages subcollection + storage files
 */

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

interface Attachment {
    storageUrl?: string;
    mimeType?: string;
}

interface Message {
    attachments?: Attachment[];
}

/**
 * Extract storage path from signed URL
 * URL format: https://storage.googleapis.com/bucket/path?token=...
 * or: https://firebasestorage.googleapis.com/v0/b/bucket/o/path?...
 */
const extractStoragePath = (storageUrl: string): string | null => {
    try {
        const url = new URL(storageUrl);

        // Format: /v0/b/bucket/o/encodedPath
        if (url.pathname.includes('/o/')) {
            const encodedPath = url.pathname.split('/o/')[1];
            return decodeURIComponent(encodedPath);
        }

        // Signed URL format: /bucket/path
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 3) {
            // Decode URL-encoded characters (e.g. %CC%8C → č, %20 → space)
            return decodeURIComponent(pathParts.slice(2).join('/'));
        }

        return null;
    } catch (e) {
        console.error('[ChatCleanup] Failed to parse storage URL:', storageUrl, e);
        return null;
    }
};

/**
 * Firestore trigger: onChatDeleted
 * Path: users/{userId}/chats/{chatId}
 */
export const onChatDeleted = onDocumentDeleted(
    {
        document: "users/{userId}/chats/{chatId}",
        memory: "512MiB",
        cpu: 1,
        concurrency: 80,
        maxInstances: 10,
        timeoutSeconds: 120,
    },
    async (event) => {
        const { userId, chatId } = event.params;
        console.log(`[ChatCleanup] Chat deleted: ${chatId} by user: ${userId}`);

        const db = admin.firestore();
        const storage = admin.storage().bucket();

        // 1. Get all messages in subcollection
        const messagesRef = db.collection(`users/${userId}/chats/${chatId}/messages`);
        const messagesSnapshot = await messagesRef.get();

        if (messagesSnapshot.empty) {
            console.log(`[ChatCleanup] No messages to clean up for chat: ${chatId}`);
            return;
        }

        console.log(`[ChatCleanup] Found ${messagesSnapshot.size} messages to clean up`);

        // 2. Collect all storage URLs from attachments
        const storagePathsToDelete: string[] = [];

        messagesSnapshot.forEach((doc) => {
            const message = doc.data() as Message;
            console.log(`[ChatCleanup] Message ${doc.id}: attachments=${JSON.stringify(message.attachments)}`);
            if (message.attachments && Array.isArray(message.attachments)) {
                message.attachments.forEach((att, i) => {
                    console.log(`[ChatCleanup] Attachment[${i}]: storageUrl=${att.storageUrl}, mimeType=${att.mimeType}`);
                    if (att.storageUrl) {
                        const path = extractStoragePath(att.storageUrl);
                        console.log(`[ChatCleanup] Extracted path: ${path}`);
                        if (path) {
                            storagePathsToDelete.push(path);
                        }
                    }
                });
            }
        });

        console.log(`[ChatCleanup] Found ${storagePathsToDelete.length} storage files to delete`);

        // 3. Delete storage files (parallel, ignore errors for missing files)
        const storageDeletePromises = storagePathsToDelete.map(async (path) => {
            try {
                await storage.file(path).delete();
                console.log(`[ChatCleanup] Deleted storage file: ${path}`);
            } catch (e: any) {
                // File might already be deleted or not exist
                if (e.code !== 404) {
                    console.error(`[ChatCleanup] Failed to delete storage file: ${path}`, e);
                }
            }
        });

        // 4. Delete all message documents (parallel)
        const messageDeletePromises = messagesSnapshot.docs.map((doc) => doc.ref.delete());

        // 5. Execute all deletes
        await Promise.all([
            ...storageDeletePromises,
            ...messageDeletePromises,
        ]);

        console.log(`[ChatCleanup] Cleanup complete for chat: ${chatId}`);
    }
);

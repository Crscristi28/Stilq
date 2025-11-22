
import { Attachment, ChatMessage } from "../types";
// We will import firebase storage functions here later
// import { ref, uploadString, getDownloadURL } from "firebase/storage";
// import { storage } from "../firebase";

/**
 * Prepares an attachment for Firestore.
 * If it's a large base64 image, we ideally upload it to Storage first 
 * and save only the URL to Firestore.
 */
export const prepareAttachmentForUpload = async (att: Attachment, userId: string, chatId: string): Promise<Attachment> => {
  // If we already have a storage URL, we are good.
  if (att.storageUrl) return att;

  // If we have data (base64), we simulate the upload logic here.
  // In the next step, you will implement the actual `uploadString` to Firebase Storage.
  if (att.data) {
      // TODO: IMPLEMENT FIREBASE UPLOAD HERE
      // const storageRef = ref(storage, `users/${userId}/chats/${chatId}/${Date.now()}_${att.name}`);
      // await uploadString(storageRef, att.data, 'base64');
      // const url = await getDownloadURL(storageRef);
      
      // return { ...att, data: undefined, storageUrl: url }; // Clear base64 to save DB space
      
      return att; // For now, return as is until Firebase keys are set
  }

  return att;
};

/**
 * Prepares a message to be saved to Firestore.
 * Ensures all attachments are uploaded and optimized.
 */
export const prepareMessageForFirestore = async (msg: ChatMessage, userId: string, chatId: string): Promise<any> => {
  let processedAttachments: Attachment[] = [];
  
  if (msg.attachments) {
    processedAttachments = await Promise.all(
        msg.attachments.map(att => prepareAttachmentForUpload(att, userId, chatId))
    );
  }

  // Return a clean object ready for Firestore
  return {
      id: msg.id,
      role: msg.role,
      text: msg.text,
      attachments: processedAttachments,
      timestamp: msg.timestamp,
      // exclude isStreaming, error, etc. for database persistence if needed
  };
};

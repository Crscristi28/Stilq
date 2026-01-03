/**
 * Auth Utility
 * Verifies Firebase ID tokens and checks admin status
 */

import * as admin from "firebase-admin";
import { Request, Response } from "express";

export interface AuthUser {
    uid: string;
    isAdmin: boolean;
}

/**
 * Verifies the Firebase ID token from Authorization header
 * Returns user info with admin status, or null if auth fails (sends 401)
 */
export const verifyAuth = async (req: Request, res: Response): Promise<AuthUser | null> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
        return null;
    }

    const token = authHeader.split('Bearer ')[1];

    if (!token) {
        res.status(401).json({ error: "Unauthorized: No token provided" });
        return null;
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        return {
            uid: decoded.uid,
            isAdmin: decoded.admin === true  // Custom claim from setAdmin script
        };
    } catch (error) {
        console.error("[Auth] Token verification failed:", error);
        res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
        return null;
    }
};

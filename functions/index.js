const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const gmailAppPassword = defineSecret("SAYVAH_GMAIL_APP_PASSWORD");
const senderEmail = defineString("SAYVAH_EMAIL_SENDER", {
  default: "rajan@s3dsystems.com",
  description: "Gmail account used to send SayVah launch signup notifications."
});

const NOTIFICATION_RECIPIENT = "rajan@s3dsystems.com";
const ALLOWED_INTERESTS = new Set([
  "Volunteer / Sevadaar",
  "I may use SayVah for support",
  "Gurdwara / Organisation",
  "Keep me updated"
]);

exports.sendLaunchSignupNotification = onDocumentCreated(
  {
    document: "launchSignups/{signupId}",
    region: "europe-west2",
    secrets: [gmailAppPassword],
    retry: true
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("Launch signup notification skipped: missing snapshot.");
      return;
    }

    const signupRef = snapshot.ref;
    const signupId = event.params.signupId;
    const current = await signupRef.get();

    if (!current.exists) {
      logger.warn("Launch signup notification skipped: document no longer exists.", { signupId });
      return;
    }

    const data = current.data() || {};
    if (data.notificationEmailSent === true) {
      logger.info("Launch signup notification already sent; skipping duplicate trigger.", { signupId });
      return;
    }

    const signup = normaliseSignup(data);
    const validationError = validateSignup(data, signup);
    if (validationError) {
      logger.warn("Launch signup notification skipped: invalid signup data.", {
        signupId,
        reason: validationError
      });
      await signupRef.update({
        notificationEmailStatus: "invalid",
        notificationEmailStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }

    const fromEmail = senderEmail.value();
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: fromEmail,
        pass: gmailAppPassword.value()
      }
    });

    const mailOptions = {
      from: `SayVah <${fromEmail}>`,
      to: NOTIFICATION_RECIPIENT,
      subject: signup.name ? `New SayVah Launch Signup - ${signup.name}` : "New SayVah Launch Signup",
      text: buildTextEmail(signup),
      html: buildHtmlEmail(signup)
    };

    if (isValidEmail(signup.email)) {
      mailOptions.replyTo = signup.email;
    }

    try {
      await transporter.sendMail(mailOptions);
      await signupRef.update({
        notificationEmailSent: true,
        notificationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        notificationEmailStatus: "sent"
      });
      logger.info("Launch signup notification sent.", { signupId });
    } catch (error) {
      logger.error("Launch signup notification failed.", {
        signupId,
        code: error && error.code ? error.code : undefined,
        command: error && error.command ? error.command : undefined
      });
      await signupRef.update({
        notificationEmailStatus: "failed",
        notificationEmailStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      throw error;
    }
  }
);


exports.preparePermanentUserDeletion = onCall(
  { region: "europe-west2" },
  async (request) => {
    const { callerUid, targetUid, targetSnap, targetData } = await validateDeletionRequest(request, { allowAdminDeletion: true });
    const dependencySummary = await collectUserDependencies(targetUid, targetData);

    await admin.firestore().collection("adminAuditLogs").add({
      adminUid: callerUid,
      action: "user_delete_preflight",
      targetType: "user",
      targetId: targetUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      summary: "Permanent user deletion preflight completed.",
      targetDisplayName: safeDisplayName(targetData, targetUid),
      targetEmail: stringValue(targetData.email),
      targetRole: stringValue(targetData.role),
      dependencySummary: dependencySummary.counts
    });

    return {
      target: safeTargetSnapshot(targetUid, targetData, targetSnap.exists),
      dependencySummary: dependencySummary.counts,
      warnings: dependencySummary.warnings,
      requiresAdminDeletionConfirmation: targetData.role === "admin"
    };
  }
);

exports.deleteUserPermanently = onCall(
  { region: "europe-west2" },
  async (request) => {
    const confirmation = stringValue(request.data && request.data.confirmation);
    const secondConfirmation = request.data && request.data.secondConfirmation === true;
    if (confirmation !== "DELETE") throw new HttpsError("failed-precondition", "Typed DELETE confirmation is required.");
    if (!secondConfirmation) throw new HttpsError("failed-precondition", "Second deletion confirmation is required.");

    const allowAdminDeletion = request.data && request.data.allowAdminDeletion === true;
    const { callerUid, targetUid, targetSnap, targetData } = await validateDeletionRequest(request, { allowAdminDeletion });
    const deletionStats = emptyDeletionStats();
    let authDeleted = false;
    let profileDeleted = false;
    let storageDeleted = false;
    const partialFailures = [];

    await admin.firestore().collection("adminAuditLogs").add({
      adminUid: callerUid,
      action: "user_delete_started",
      targetType: "user",
      targetId: targetUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      summary: "Permanent user deletion started.",
      targetDisplayName: safeDisplayName(targetData, targetUid),
      targetEmail: stringValue(targetData.email),
      targetRole: stringValue(targetData.role)
    });

    await runCleanupStep(partialFailures, "requests", async () => handleUserRequests(targetUid, deletionStats));
    await runCleanupStep(partialFailures, "help_connections", async () => deleteQueryMatches("help_connections", ["requesterId", "helperId", "userId"], targetUid, deletionStats));
    await runCleanupStep(partialFailures, "sessions", async () => deleteQueryMatches("sessions", ["userId", "uid"], targetUid, deletionStats));
    await runCleanupStep(partialFailures, "location_sessions", async () => deleteQueryMatches("location_sessions", ["userId", "uid"], targetUid, deletionStats));
    await runCleanupStep(partialFailures, "ratings", async () => anonymiseQueryMatches("ratings", ["fromUserId", "toUserId", "userId"], targetUid, deletionStats, { fromUserName: "Deleted User", toUserName: "Deleted User", userName: "Deleted User" }));
    await runCleanupStep(partialFailures, "reports", async () => anonymiseQueryMatches("reports", ["reporterId", "reportedUserId", "userId"], targetUid, deletionStats, { reporterName: "Deleted User", reportedUserName: "Deleted User", userName: "Deleted User" }));
    await runCleanupStep(partialFailures, "trustProfiles", async () => deleteTrustProfile(targetUid, deletionStats));
    await runCleanupStep(partialFailures, "chats", async () => handleUserChats(targetUid, deletionStats));
    await runCleanupStep(partialFailures, "messages", async () => anonymiseMessages(targetUid, deletionStats));
    await runCleanupStep(partialFailures, "gurdwaras", async () => removeArrayReferences("gurdwaras", ["admins", "adminIds", "managedBy", "managerIds"], targetUid, deletionStats));
    await runCleanupStep(partialFailures, "organisations", async () => removeArrayReferences("organisations", ["admins", "adminIds", "managedBy", "managerIds"], targetUid, deletionStats));
    await runCleanupStep(partialFailures, "storage", async () => { storageDeleted = await deleteOwnedStorage(targetUid, targetData); });

    await runCleanupStep(partialFailures, "auth", async () => {
      try {
        await admin.auth().deleteUser(targetUid);
        authDeleted = true;
      } catch (error) {
        if (error.code === "auth/user-not-found") authDeleted = true;
        else throw error;
      }
    });

    if (authDeleted && targetSnap.exists) {
      await runCleanupStep(partialFailures, "users", async () => {
        await admin.firestore().collection("users").doc(targetUid).delete();
        deletionStats.recordsDeleted += 1;
        profileDeleted = true;
      });
    } else if (!targetSnap.exists) {
      profileDeleted = true;
    }

    await admin.firestore().collection("adminAuditLogs").add({
      adminUid: callerUid,
      action: partialFailures.length ? "user_delete_attention_required" : "user_permanently_deleted",
      targetType: "user",
      targetId: targetUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      summary: partialFailures.length ? "Permanent user deletion requires attention." : "User permanently deleted.",
      targetDisplayName: safeDisplayName(targetData, targetUid),
      targetEmail: stringValue(targetData.email),
      targetRole: stringValue(targetData.role),
      authDeleted,
      profileDeleted,
      storageDeleted,
      recordsDeleted: deletionStats.recordsDeleted,
      recordsAnonymised: deletionStats.recordsAnonymised,
      recordsPreserved: deletionStats.recordsPreserved,
      partialFailures: partialFailures.map((failure) => failure.step)
    });

    if (partialFailures.length) {
      throw new HttpsError("internal", "User deletion requires attention.", {
        authDeleted,
        profileDeleted,
        storageDeleted,
        recordsDeleted: deletionStats.recordsDeleted,
        recordsAnonymised: deletionStats.recordsAnonymised,
        recordsPreserved: deletionStats.recordsPreserved,
        partialFailures: partialFailures.map((failure) => ({ step: failure.step, message: failure.message }))
      });
    }

    return {
      authDeleted,
      profileDeleted,
      storageDeleted,
      recordsDeleted: deletionStats.recordsDeleted,
      recordsAnonymised: deletionStats.recordsAnonymised,
      recordsPreserved: deletionStats.recordsPreserved
    };
  }
);

async function validateDeletionRequest(request, options = {}) {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Authentication required.");

  const callerSnap = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerSnap.exists || (callerSnap.data() || {}).role !== "admin") {
    throw new HttpsError("permission-denied", "SayVah admin role required.");
  }

  const targetUid = stringValue(request.data && request.data.uid);
  if (!targetUid) throw new HttpsError("invalid-argument", "Target UID is required.");
  if (targetUid === callerUid) throw new HttpsError("failed-precondition", "Admins cannot delete their own account.");

  const targetSnap = await admin.firestore().collection("users").doc(targetUid).get();
  const targetData = targetSnap.exists ? targetSnap.data() || {} : {};
  if (!targetSnap.exists && options.requireExisting !== false) throw new HttpsError("not-found", "Target user does not exist.");

  if (isProtectedAdmin(targetData)) throw new HttpsError("failed-precondition", "Protected admin accounts cannot be deleted.");
  if (targetData.role === "admin") {
    const adminCountSnap = await admin.firestore().collection("users").where("role", "==", "admin").count().get();
    if ((adminCountSnap.data().count || 0) <= 1) throw new HttpsError("failed-precondition", "Cannot delete the last admin account.");
    if (!options.allowAdminDeletion && !(request.data && request.data.allowAdminDeletion === true)) {
      throw new HttpsError("failed-precondition", "Deleting another admin requires explicit admin deletion confirmation.");
    }
  }

  return { callerUid, targetUid, callerData: callerSnap.data() || {}, targetSnap, targetData };
}

function isProtectedAdmin(user) {
  return user.superAdmin === true || user.isSuperAdmin === true || user.protectedAdmin === true || user.deletionProtected === true;
}

async function collectUserDependencies(uid, user = {}) {
  const counts = await linkedUserRecordCounts(uid);
  counts["users.profile"] = user && Object.keys(user).length ? 1 : 0;
  counts["trustProfiles.profile"] = await documentExistsCount("trustProfiles", uid);
  counts["storage.ownedProfileFiles"] = ownedStoragePaths(uid, user).length;
  counts["messages.senderId"] = await collectionGroupCount("messages", "senderId", uid);
  counts["messages.uid"] = await collectionGroupCount("messages", "uid", uid);
  const warnings = [];
  if (user.role === "admin") warnings.push("Target user is an admin account.");
  if (Array.isArray(user.managedGurdwaraIds) && user.managedGurdwaraIds.length) warnings.push("Target user has managedGurdwaraIds on profile.");
  return { counts, warnings };
}


async function documentExistsCount(collectionName, id) {
  try {
    const snap = await admin.firestore().collection(collectionName).doc(id).get();
    return snap.exists ? 1 : 0;
  } catch (error) {
    logger.warn("Permanent user deletion document count failed.", { collectionName, id, message: error.message });
    return -1;
  }
}

async function deleteTrustProfile(uid, stats) {
  const ref = admin.firestore().collection("trustProfiles").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.delete();
  stats.recordsDeleted += 1;
}
async function collectionGroupCount(collectionName, field, uid) {
  try {
    const snap = await admin.firestore().collectionGroup(collectionName).where(field, "==", uid).count().get();
    return snap.data().count || 0;
  } catch (error) {
    logger.warn("Permanent user deletion collection-group count failed.", { collectionName, field, uid, message: error.message });
    return -1;
  }
}

async function linkedUserRecordCounts(uid) {
  const checks = [
    ["requests", "requesterId"],
    ["requests", "userId"],
    ["requests", "helperId"],
    ["requests", "sevadaarId"],
    ["help_connections", "requesterId"],
    ["help_connections", "helperId"],
    ["help_connections", "userId"],
    ["sessions", "userId"],
    ["sessions", "uid"],
    ["location_sessions", "userId"],
    ["location_sessions", "uid"],
    ["ratings", "fromUserId"],
    ["ratings", "toUserId"],
    ["ratings", "userId"],
    ["reports", "reporterId"],
    ["reports", "reportedUserId"],
    ["reports", "userId"],
    ["chats", "participantIds"],
    ["gurdwaras", "adminIds"],
    ["gurdwaras", "admins"],
    ["organisations", "adminIds"],
    ["organisations", "admins"]
  ];
  const result = {};
  await Promise.all(checks.map(async ([collectionName, field]) => {
    const key = `${collectionName}.${field}`;
    try {
      let query = admin.firestore().collection(collectionName).where(field, "==", uid);
      if (["participantIds", "adminIds", "admins"].includes(field)) query = admin.firestore().collection(collectionName).where(field, "array-contains", uid);
      const snap = await query.count().get();
      result[key] = snap.data().count || 0;
    } catch (error) {
      logger.warn("Permanent user deletion count failed.", { collectionName, field, uid, message: error.message });
      result[key] = -1;
    }
  }));
  return result;
}

async function handleUserRequests(uid, stats) {
  const refs = await uniqueDocsFromQueries("requests", ["requesterId", "userId", "helperId", "sevadaarId"], uid);
  for (const ref of refs) {
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const group = requestStatusGroup(data.status);
    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), deletedUserParticipantIds: admin.firestore.FieldValue.arrayUnion(uid) };
    if (["open", "active"].includes(group) && (data.requesterId === uid || data.userId === uid)) {
      update.status = "closed";
      update.closedAt = admin.firestore.FieldValue.serverTimestamp();
      update.closedReason = "requester_deleted";
    }
    for (const field of ["requesterName", "helperName", "sevadaarName", "userName", "createdByName"]) {
      if (data[field]) update[field] = "Deleted User";
    }
    await ref.update(update);
    stats.recordsAnonymised += 1;
  }
}

async function handleUserChats(uid, stats) {
  const refs = await uniqueDocsFromQueries("chats", ["participantIds"], uid, { arrayFields: ["participantIds"] });
  for (const ref of refs) {
    await ref.update({
      [`deletedParticipants.${uid}`]: true,
      deletedParticipantIds: admin.firestore.FieldValue.arrayUnion(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    stats.recordsPreserved += 1;
  }
}

async function anonymiseMessages(uid, stats) {
  const refs = await uniqueDocsFromQueries("messages", ["senderId", "uid"], uid, { collectionGroup: true });
  for (const ref of refs) {
    await ref.update({ senderName: "Deleted User", senderDeleted: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    stats.recordsAnonymised += 1;
  }
}

async function deleteQueryMatches(collectionName, fields, uid, stats) {
  const refs = await uniqueDocsFromQueries(collectionName, fields, uid);
  await chunkedWrites(refs, async (batch, ref) => batch.delete(ref));
  stats.recordsDeleted += refs.length;
}

async function anonymiseQueryMatches(collectionName, fields, uid, stats, extraUpdate) {
  const refs = await uniqueDocsFromQueries(collectionName, fields, uid);
  await chunkedWrites(refs, async (batch, ref) => batch.update(ref, { ...extraUpdate, deletedUserParticipantIds: admin.firestore.FieldValue.arrayUnion(uid), updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
  stats.recordsAnonymised += refs.length;
}

async function removeArrayReferences(collectionName, fields, uid, stats) {
  const refs = await uniqueDocsFromQueries(collectionName, fields, uid, { arrayFields: fields });
  await chunkedWrites(refs, async (batch, ref) => {
    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), deletedAdminIds: admin.firestore.FieldValue.arrayUnion(uid) };
    fields.forEach((field) => { update[field] = admin.firestore.FieldValue.arrayRemove(uid); });
    batch.update(ref, update);
  });
  stats.recordsAnonymised += refs.length;
}

async function uniqueDocsFromQueries(collectionName, fields, uid, options = {}) {
  const seen = new Map();
  for (const field of fields) {
    try {
      const root = options.collectionGroup ? admin.firestore().collectionGroup(collectionName) : admin.firestore().collection(collectionName);
      const op = (options.arrayFields || []).includes(field) ? "array-contains" : "==";
      const snap = await root.where(field, op, uid).get();
      snap.docs.forEach((doc) => seen.set(doc.ref.path, doc.ref));
    } catch (error) {
      logger.warn("Permanent user deletion query failed.", { collectionName, field, uid, message: error.message });
      throw error;
    }
  }
  return Array.from(seen.values());
}

async function chunkedWrites(refs, writeFn) {
  for (let index = 0; index < refs.length; index += 450) {
    const batch = admin.firestore().batch();
    refs.slice(index, index + 450).forEach((ref) => writeFn(batch, ref));
    await batch.commit();
  }
}

async function deleteOwnedStorage(uid, user) {
  const paths = ownedStoragePaths(uid, user);
  if (!paths.length) return false;
  await Promise.all(paths.map((path) => admin.storage().bucket().file(path).delete({ ignoreNotFound: true })));
  return true;
}

function ownedStoragePaths(uid, user) {
  const fields = ["photoPath", "profilePhotoPath", "profileImagePath", "avatarPath", "idDocumentPath", "identityDocumentPath", "verificationDocumentPath", "verificationImagePath", "selfiePath", "proofPath", "documentPath"];
  return fields
    .map((field) => stringValue(user[field]))
    .filter((path) => path && !/^https?:\/\//i.test(path) && (path.includes(uid) || path.startsWith(`users/${uid}/`) || path.startsWith(`profileImages/${uid}/`)));
}

function requestStatusGroup(status) {
  const value = stringValue(status).toLowerCase();
  if (["open", "pending", "new"].includes(value)) return "open";
  if (["accepted", "in_progress", "in progress", "active", "helping"].includes(value)) return "active";
  if (["completed", "complete", "resolved", "done"].includes(value)) return "completed";
  if (["cancelled", "canceled", "closed", "dismissed", "inactive"].includes(value)) return "closed";
  return value || "open";
}

async function runCleanupStep(partialFailures, step, task) {
  try {
    await task();
  } catch (error) {
    logger.error("Permanent user deletion step failed.", { step, message: error.message });
    partialFailures.push({ step, message: error.message });
  }
}

function emptyDeletionStats() { return { recordsDeleted: 0, recordsAnonymised: 0, recordsPreserved: 0 }; }
function safeTargetSnapshot(uid, user, profileExists) { return { uid, profileExists, displayName: safeDisplayName(user, uid), email: stringValue(user.email), role: stringValue(user.role) || "user" }; }
function safeDisplayName(user, uid) { return stringValue(user.fullName) || stringValue(user.name) || stringValue(user.displayName) || stringValue(user.username) || stringValue(user.email) || uid; }
function normaliseSignup(data) {
  return {
    name: stringValue(data.name),
    email: stringValue(data.email),
    area: stringValue(data.area),
    interest: stringValue(data.interest),
    message: stringValue(data.message),
    consent: data.consent === true,
    createdAt: data.createdAt,
    source: stringValue(data.source)
  };
}

function validateSignup(rawData, signup) {
  const expectedFields = ["name", "email", "area", "interest", "message", "consent", "createdAt", "source"];
  const missingField = expectedFields.find((field) => !Object.prototype.hasOwnProperty.call(rawData, field));
  if (missingField) return `missing-${missingField}`;
  if (!signup.area) return "missing-area";
  if (!ALLOWED_INTERESTS.has(signup.interest)) return "invalid-interest";
  if (signup.consent !== true) return "missing-consent";
  if (signup.source !== "website") return "invalid-source";
  return null;
}

function buildTextEmail(signup) {
  return [
    "SayVah",
    "New Launch Signup",
    "",
    `Name: ${signup.name || "Not provided"}`,
    `Email: ${signup.email || "Not provided"}`,
    `Area: ${signup.area}`,
    `Interest: ${signup.interest}`,
    "",
    "Message:",
    signup.message || "(No message provided)",
    "",
    "Submitted:",
    formatTimestamp(signup.createdAt),
    "",
    "Source:",
    formatSource(signup.source)
  ].join("\n");
}

function buildHtmlEmail(signup) {
  const safeEmail = escapeHtml(signup.email || "Not provided");
  const emailLink = isValidEmail(signup.email)
    ? `<a href="mailto:${encodeAttribute(signup.email)}" style="color:#0f6f86;">${safeEmail}</a>`
    : safeEmail;

  return `
    <div style="margin:0;padding:24px;background:#06111f;font-family:Arial,Helvetica,sans-serif;color:#102033;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d8e6ec;">
        <div style="padding:24px;background:#071321;color:#ffffff;">
          <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#55d9ef;font-weight:700;">SayVah</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#ffffff;">New Launch Signup</h1>
        </div>
        <div style="padding:24px;">
          ${detailRow("Name", signup.name || "Not provided")}
          ${detailRow("Email", emailLink, true)}
          ${detailRow("Area", signup.area)}
          ${detailRow("Interest", signup.interest)}
          <div style="margin:22px 0;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#617382;font-weight:700;">Message</div>
            <div style="margin-top:8px;padding:14px;border-radius:12px;background:#f4f8fa;border:1px solid #dce8ee;color:#102033;white-space:pre-wrap;">${escapeHtml(signup.message || "(No message provided)")}</div>
          </div>
          ${detailRow("Submitted", formatTimestamp(signup.createdAt))}
          ${detailRow("Source", formatSource(signup.source))}
        </div>
      </div>
    </div>
  `;
}

function detailRow(label, value, alreadyEscaped = false) {
  return `
    <div style="margin:0 0 14px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#617382;font-weight:700;">${escapeHtml(label)}</div>
      <div style="margin-top:4px;font-size:16px;color:#102033;">${alreadyEscaped ? value : escapeHtml(value)}</div>
    </div>
  `;
}

function formatTimestamp(value) {
  const date = value && typeof value.toDate === "function" ? value.toDate() : null;
  if (!date) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/London"
  }).format(date);
}

function formatSource(source) {
  return source === "website" ? "SayVah Website" : source || "Not recorded";
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function encodeAttribute(value) {
  return encodeURIComponent(value).replaceAll("%40", "@");
}

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
    const callerUid = request.auth && request.auth.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Authentication required.");

    const callerSnap = await admin.firestore().collection("users").doc(callerUid).get();
    if (!callerSnap.exists || (callerSnap.data() || {}).role !== "admin") {
      throw new HttpsError("permission-denied", "SayVah admin role required.");
    }

    const targetUid = stringValue(request.data && request.data.uid);
    const confirmation = stringValue(request.data && request.data.confirmation);
    if (!targetUid) throw new HttpsError("invalid-argument", "Target UID is required.");
    if (targetUid === callerUid) throw new HttpsError("failed-precondition", "Admins cannot delete their own account.");
    if (confirmation !== "DELETE") throw new HttpsError("failed-precondition", "Typed DELETE confirmation is required.");

    const targetRef = admin.firestore().collection("users").doc(targetUid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Target user does not exist.");

    const linkedRecords = await linkedUserRecordCounts(targetUid);
    const hasLinkedRecords = Object.values(linkedRecords).some((count) => count > 0);
    await admin.firestore().collection("adminAuditLogs").add({
      adminUid: callerUid,
      action: "user_delete_preflight",
      targetType: "user",
      targetId: targetUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      summary: hasLinkedRecords ? "Permanent user deletion blocked by linked SayVah records." : "Permanent user deletion preflight completed; deletion service still requires final cleanup policy.",
      linkedRecords
    });

    throw new HttpsError(
      "failed-precondition",
      hasLinkedRecords
        ? "Permanent deletion requires dependency-aware cleanup for linked SayVah records."
        : "Permanent deletion service is prepared but final Auth/Storage cleanup policy is not enabled."
    );
  }
);

async function linkedUserRecordCounts(uid) {
  const checks = [
    ["requests", "requesterId"],
    ["requests", "userId"],
    ["requests", "helperId"],
    ["help_connections", "requesterId"],
    ["help_connections", "helperId"],
    ["sessions", "userId"],
    ["location_sessions", "userId"],
    ["ratings", "fromUserId"],
    ["ratings", "toUserId"],
    ["reports", "reporterId"],
    ["reports", "reportedUserId"],
    ["chats", "participantIds"]
  ];
  const result = {};
  await Promise.all(checks.map(async ([collectionName, field]) => {
    const key = `${collectionName}.${field}`;
    try {
      let query = admin.firestore().collection(collectionName).where(field, "==", uid);
      if (field === "participantIds") query = admin.firestore().collection(collectionName).where(field, "array-contains", uid);
      const snap = await query.count().get();
      result[key] = snap.data().count || 0;
    } catch (error) {
      logger.warn("Permanent user deletion preflight count failed.", { collectionName, field, uid, message: error.message });
      result[key] = -1;
    }
  }));
  return result;
}
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

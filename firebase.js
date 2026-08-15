import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2gzxxVo1WEHr8_BynpuyvxVry0WwqV7Q",
  authDomain: "seva-app-b6a18.firebaseapp.com",
  projectId: "seva-app-b6a18",
  storageBucket: "seva-app-b6a18.firebasestorage.app",
  messagingSenderId: "1046020854100",
  appId: "1:1046020854100:web:eec028446676e8141178c1",
  measurementId: "G-5FBW6MM28K"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const locationsList = document.getElementById("live-locations");
const ALLOWED_LAUNCH_INTERESTS = new Set([
  "Volunteer / Sevadaar",
  "I may use SayVah for support",
  "Gurdwara / Organisation",
  "Keep me updated"
]);

const launchForm = document.getElementById("launch-form");
const launchSubmit = document.getElementById("launch-submit");
const launchStatus = document.getElementById("launch-form-status");
let launchSubmitting = false;

// Firestore rules should allow public create only on launchSignups.
// Public reads, updates and deletes must remain blocked, and existing protected collections must not be weakened.
if (launchForm) {
  launchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (launchSubmitting) return;

    const formData = new FormData(launchForm);
    const signup = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      area: String(formData.get("area") || "").trim(),
      interest: String(formData.get("interest") || "").trim(),
      message: String(formData.get("message") || "").trim(),
      consent: formData.get("consent") === "on"
    };

    if (!signup.name || !signup.email || !signup.area || !ALLOWED_LAUNCH_INTERESTS.has(signup.interest) || !signup.consent) {
      setLaunchStatus("Please complete the required fields and consent checkbox.", "error");
      return;
    }

    if (!launchForm.reportValidity()) return;

    launchSubmitting = true;
    launchForm.classList.add("is-submitting");
    if (launchSubmit) {
      launchSubmit.disabled = true;
      launchSubmit.textContent = "Joining...";
    }
    setLaunchStatus("Adding you to the launch list...", "");

    try {
      await addDoc(collection(db, "launchSignups"), {
        name: signup.name,
        email: signup.email,
        area: signup.area,
        interest: signup.interest,
        message: signup.message,
        consent: true,
        createdAt: serverTimestamp(),
        source: "website"
      });

      launchForm.reset();
      setLaunchStatus("You're on the list. Thank you for supporting SayVah.", "success");
    } catch (error) {
      console.error("Unable to submit SayVah launch signup.", error?.code || error?.name || "unknown-error");
      setLaunchStatus("Sorry, we couldn't add you right now. Please try again in a moment.", "error");
    } finally {
      launchSubmitting = false;
      launchForm.classList.remove("is-submitting");
      if (launchSubmit) {
        launchSubmit.disabled = false;
        launchSubmit.textContent = "Join the Launch";
      }
    }
  });
}

function setLaunchStatus(message, type) {
  if (!launchStatus) return;
  launchStatus.textContent = message;
  launchStatus.classList.remove("success", "error");
  if (type) launchStatus.classList.add(type);
}


if (locationsList) {
  const locationsQuery = query(
    collection(db, "locations"),
    where("active", "==", true)
  );

  onSnapshot(
    locationsQuery,
    (snapshot) => {
      const locations = snapshot.docs
        .map((doc) => doc.data())
        .filter((item) => item.name)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (locations.length === 0) {
        locationsList.innerHTML = `
          <div class="live-location-empty">
            No active SayVah areas are currently listed.
          </div>
        `;
        return;
      }

      locationsList.innerHTML = locations
        .map(
          (location) => `
            <div class="live-location-card">
              <div class="live-location-icon">⌖</div>

              <div>
                <strong>${escapeHtml(location.name)}</strong>
                <span>Active SayVah area</span>
              </div>

              <div class="live-location-status">
                Live
              </div>
            </div>
          `
        )
        .join("");
    },
    (error) => {
      console.error("Unable to load SayVah locations:", error);

      locationsList.innerHTML = `
        <div class="live-location-empty">
          Areas could not be loaded right now.
        </div>
      `;
    }
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
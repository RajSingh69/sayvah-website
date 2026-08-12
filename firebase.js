import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot
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
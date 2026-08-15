const SUPPORT_EMAIL = 'support@sayvah.co.uk';

const LAUNCH_DATE = new Date('2026-08-31T23:00:00.000Z'); // 1 September 2026 at 00:00 UK time (BST).
const countdown = document.getElementById('launch-countdown');
const countdownParts = {
  days: document.querySelector('[data-countdown="days"]'),
  hours: document.querySelector('[data-countdown="hours"]'),
  minutes: document.querySelector('[data-countdown="minutes"]'),
  seconds: document.querySelector('[data-countdown="seconds"]')
};

function updateCountdown() {
  if (!countdown) return;
  const remaining = LAUNCH_DATE.getTime() - Date.now();
  if (remaining <= 0) {
    countdown.innerHTML = '<div class="countdown-live">SayVah is now live.</div>';
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (countdownParts.days) countdownParts.days.textContent = String(days);
  if (countdownParts.hours) countdownParts.hours.textContent = String(hours).padStart(2, '0');
  if (countdownParts.minutes) countdownParts.minutes.textContent = String(minutes).padStart(2, '0');
  if (countdownParts.seconds) countdownParts.seconds.textContent = String(seconds).padStart(2, '0');
}

updateCountdown();
setInterval(updateCountdown, 1000);

document.querySelectorAll('.volunteer-jump').forEach(link => {
  link.addEventListener('click', () => {
    const interest = link.dataset.interest;
    const interestField = document.getElementById('launch-interest');
    if (interestField && interest) interestField.value = interest;
  });
});


const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('.main-nav');
menuToggle?.addEventListener('click', () => {
  const open = mainNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
});
mainNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  mainNav.classList.remove('open');
  menuToggle?.setAttribute('aria-expanded', 'false');
}));

const pathButtons = document.querySelectorAll('.path-button');
const pathPanels = document.querySelectorAll('.path-panel');
pathButtons.forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.tab;
  pathButtons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
  pathPanels.forEach(panel => { panel.classList.remove('active'); panel.hidden = true; });
  button.classList.add('active');
  button.setAttribute('aria-selected','true');
  const panel = document.getElementById(id);
  if (panel) { panel.hidden = false; panel.classList.add('active'); }
}));

const guides = {
  account: { title: 'Create your account', steps: ['Download and open SayVah.', 'Choose the sign-up option and enter your account details.', 'Select your local area.', 'Add a clear profile picture and useful profile information.', 'Review your settings and finish your profile before requesting or offering help.'] },
  request: { title: 'Create a request', steps: ['Open the Requests tab.', 'Tap Create Request.', 'Choose the most suitable request type.', 'Describe exactly what practical support you need.', 'Add the relevant date, time and general area.', 'Review the request before publishing it.'] },
  offer: { title: 'Offer to help', steps: ['Open Browse Requests.', 'Choose a request that genuinely suits your availability and ability.', 'Read every detail carefully.', 'Use the app to offer your help.', 'Wait for the requester or admin process before proceeding.', 'Confirm the agreed details in chat.'] },
  chat: { title: 'Use chat safely', steps: ['Keep messages relevant to the request.', 'Do not share unnecessary private information.', 'Confirm the task, timing and meeting arrangements clearly.', 'If something becomes inappropriate, stop the conversation and use the safety tools.'] },
  report: { title: 'Report or block a user', steps: ['Open the relevant user, request or conversation.', 'Choose the report option and select the closest reason.', 'Add a clear explanation where needed.', 'Block the user if you do not want further contact.', 'If someone is in immediate danger, contact the appropriate emergency service.'] },
  delete: { title: 'Delete your account', steps: ['Open the Account tab.', 'Open Edit Profile.', 'Scroll to Account & Security.', 'Tap Delete Account.', 'Read the warning carefully.', 'Type DELETE when prompted and confirm permanent deletion.'] }
};

const detailTitle = document.getElementById('guide-title');
const detailSteps = document.getElementById('guide-steps');
function showGuide(key) {
  const guide = guides[key];
  if (!guide || !detailTitle || !detailSteps) return;
  detailTitle.textContent = guide.title;
  detailSteps.innerHTML = guide.steps.map(step => `<li>${step}</li>`).join('');
  document.querySelectorAll('.guide-card').forEach(card => card.classList.toggle('active', card.dataset.guide === key));
}
document.querySelectorAll('.guide-card').forEach(card => card.addEventListener('click', () => showGuide(card.dataset.guide)));
showGuide('account');

document.querySelectorAll('.accordion article').forEach(item => {
  const button = item.querySelector('button');
  button?.addEventListener('click', () => {
    const isOpen = item.classList.toggle('open');
    button.setAttribute('aria-expanded', String(isOpen));
    const symbol = button.querySelector('span:last-child');
    if (symbol) symbol.textContent = isOpen ? '−' : '＋';
  });
});

document.getElementById('contact-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const subject = encodeURIComponent(`SayVah website enquiry - ${form.get('topic')}`);
  const body = encodeURIComponent(`Name: ${form.get('name')}\nEmail: ${form.get('email')}\nTopic: ${form.get('topic')}\n\n${form.get('message')}`);
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
});

document.getElementById('year').textContent = new Date().getFullYear();

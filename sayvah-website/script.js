const SUPPORT_EMAIL = 'support@sayvah.co.uk';

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

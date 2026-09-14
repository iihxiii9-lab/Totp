// data.js — static plan & workout content, no DOM or storage logic here.
// Area ids are shared across PLAN days, TARGET_AREAS, and WORKOUTS so a tap
// anywhere in the app can resolve to the right icon and exercise set.

// Hand-drawn, brand-consistent line icons (24x24, stroke-based) — no emoji,
// no external images, so everything keeps working offline.
const ICONS = {
  "full-body": '<path d="M12 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/><path d="M12 8v6M12 8 7 10M12 8l5 2M12 14l-3 7M12 14l3 7"/>',
  arm: '<circle cx="4.5" cy="8" r="1.6"/><circle cx="19.5" cy="8" r="1.6"/><path d="M6 8h2.5c.9 0 1.5.6 1.9 1.4l1 2.1a2 2 0 0 0 3.2 0l1-2.1c.4-.8 1-1.4 1.9-1.4H18"/><path d="M9.3 11.3 7 17M14.7 11.3 17 17"/>',
  abs: '<path d="M12 3c2.5 2.6 4.5 5.4 4.5 8.6A4.5 4.5 0 0 1 12 16a4.5 4.5 0 0 1-4.5-4.4C7.5 8.4 9.5 5.6 12 3Z"/><path d="M12 9.2c.9.9 1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 .6-1.9 1.5-2.8Z"/>',
  leg: '<path d="M13 2 6 13h4l-1 9 7-12h-4l1-8z"/>',
  back: '<path d="M12 3 5 9l2 1.6L12 6l5 4.6L19 9z"/><path d="M12 10 5 16l2 1.6L12 13l5 4.6L19 16z"/>',
  butt: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/>',
  chest: '<path d="M12 4 4 7v6c0 4 3.5 6.6 8 7 4.5-.4 8-3 8-7V7z"/>',
};

const AREA_META = {
  "full-body": { label: "Full Body" },
  arm: { label: "Arm" },
  butt: { label: "Butt" },
  abs: { label: "Abs" },
  leg: { label: "Leg" },
  back: { label: "Back" },
  chest: { label: "Chest" },
};

function iconMarkup(key) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[key] || ICONS["full-body"]}</svg>`;
}

// Normalizes a display label ("Full Body") to its area id ("full-body").
function toAreaId(label) {
  return label.toLowerCase().trim().replace(/\s+/g, "-");
}

const PLAN = [
  { week: 1, kcal: 1890, days: [
    { day: 1, type: "Chest", done: true },
    { day: 2, type: "Abs", done: true },
    { day: 3, type: "Full Body", done: false, today: true },
    { day: 4, type: "Rest", rest: true },
    { day: 5, type: "Chest", done: false },
    { day: 6, type: "Abs", done: false },
    { day: 7, type: "Arm", done: false },
  ]},
  { week: 2, kcal: 1920, days: [
    { day: 1, type: "Arm", done: false },
    { day: 2, type: "Chest", done: false },
    { day: 3, type: "Abs", done: false },
    { day: 4, type: "Rest", rest: true },
    { day: 5, type: "Full Body", done: false },
    { day: 6, type: "Rest", rest: true },
    { day: 7, type: "Arm", done: false },
  ]},
  { week: 3, kcal: 1960, days: [
    { day: 1, type: "Full Body", done: false },
    { day: 2, type: "Abs", done: false },
    { day: 3, type: "Arm", done: false },
    { day: 4, type: "Chest", done: false },
    { day: 5, type: "Rest", rest: true },
    { day: 6, type: "Abs", done: false },
    { day: 7, type: "Full Body", done: false },
  ]},
  { week: 4, kcal: 2005, days: [
    { day: 1, type: "Chest", done: false },
    { day: 2, type: "Full Body", done: false },
    { day: 3, type: "Rest", rest: true },
    { day: 4, type: "Abs", done: false },
    { day: 5, type: "Arm", done: false },
    { day: 6, type: "Full Body", done: false },
    { day: 7, type: "Rest", rest: true },
  ]},
];

const TARGET_AREAS = ["full-body", "arm", "butt", "abs", "leg", "back"].map((id) => ({
  id,
  label: AREA_META[id].label,
}));

const WORKOUTS = [
  { id: "w1", name: "HIIT for Weight Loss", area: "full-body", minutes: 14, kcal: 120 },
  { id: "w2", name: "Simple Arm Burn", area: "arm", minutes: 8, kcal: 60 },
  { id: "w3", name: "Full Body Workout", area: "full-body", minutes: 14, kcal: 130 },
  { id: "w4", name: "Shoulder & Back Sculpt", area: "back", minutes: 10, kcal: 80 },
  { id: "w5", name: "Abs on Fire", area: "abs", minutes: 12, kcal: 95 },
  { id: "w6", name: "Lower Body Burn", area: "leg", minutes: 15, kcal: 110 },
  { id: "w7", name: "Peach Lift", area: "butt", minutes: 11, kcal: 90 },
  { id: "w8", name: "Chest Press Basics", area: "chest", minutes: 10, kcal: 75 },
];

// Exercise sets per area — drives the workout player wherever it's opened from
// (hero "Start", a day pill, a target card, or a Discover list item).
const EXERCISES_BY_AREA = {
  "full-body": [
    { name: "Jumping Jacks", seconds: 30 },
    { name: "Donkey Kicks", seconds: 25 },
    { name: "Push-Ups", seconds: 30 },
    { name: "Mountain Climbers", seconds: 30 },
    { name: "Plank Hold", seconds: 30 },
    { name: "Bodyweight Squats", seconds: 35 },
  ],
  arm: [
    { name: "Arm Circles", seconds: 20 },
    { name: "Push-Ups", seconds: 30 },
    { name: "Tricep Dips", seconds: 25 },
    { name: "Diamond Push-Ups", seconds: 25 },
    { name: "Plank Shoulder Taps", seconds: 30 },
  ],
  abs: [
    { name: "Crunches", seconds: 30 },
    { name: "Plank Hold", seconds: 30 },
    { name: "Bicycle Crunches", seconds: 30 },
    { name: "Leg Raises", seconds: 25 },
    { name: "Russian Twists", seconds: 30 },
  ],
  leg: [
    { name: "Bodyweight Squats", seconds: 35 },
    { name: "Lunges", seconds: 30 },
    { name: "Wall Sit", seconds: 30 },
    { name: "Calf Raises", seconds: 25 },
    { name: "Jump Squats", seconds: 25 },
  ],
  back: [
    { name: "Superman Hold", seconds: 25 },
    { name: "Reverse Snow Angels", seconds: 25 },
    { name: "Bird Dog", seconds: 30 },
    { name: "Prone Y-Raise", seconds: 25 },
  ],
  butt: [
    { name: "Donkey Kicks", seconds: 25 },
    { name: "Glute Bridges", seconds: 30 },
    { name: "Fire Hydrants", seconds: 25 },
    { name: "Single-Leg Deadlift", seconds: 25 },
  ],
  chest: [
    { name: "Push-Ups", seconds: 30 },
    { name: "Incline Push-Ups", seconds: 25 },
    { name: "Chest Squeeze Press", seconds: 25 },
    { name: "Plank to Push-Up", seconds: 30 },
  ],
};

// Backward-compatible default used by the hero "Start today's workout" button.
const TODAY_EXERCISES = EXERCISES_BY_AREA["full-body"];

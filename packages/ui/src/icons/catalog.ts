import { additionalIcons, additionalIconViewBox } from "./icon/additional-icons"

// Artwork uses one optical grid; provenance and licenses are recorded in NOTICE.md.
const icons = {
  "rail-chat": {
    viewBox: "0 0 16 16",
    body: `<g><path d="M3.5 2.5h9A1.5 1.5 0 0 1 14 4v5.5a1.5 1.5 0 0 1-1.5 1.5H6.8L3.8 13.5V11H3.5A1.5 1.5 0 0 1 2 9.5V4a1.5 1.5 0 0 1 1.5-1.5Z" fill="currentColor" fill-opacity="var(--icon-active-fill, 0)"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M3.5 2.5h9A1.5 1.5 0 0 1 14 4v5.5a1.5 1.5 0 0 1-1.5 1.5H6.8L3.8 13.5V11H3.5A1.5 1.5 0 0 1 2 9.5V4a1.5 1.5 0 0 1 1.5-1.5Z"/><circle vector-effect="non-scaling-stroke" cx="5.5" cy="6.75" r="0.8" fill="currentColor" stroke="none"/><circle vector-effect="non-scaling-stroke" cx="8" cy="6.75" r="0.8" fill="currentColor" stroke="none"/><circle vector-effect="non-scaling-stroke" cx="10.5" cy="6.75" r="0.8" fill="currentColor" stroke="none"/></g></g>`,
  },
  "rail-coding": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M5 4.75 1.75 8 5 11.25"/><path vector-effect="non-scaling-stroke" d="M11 4.75 14.25 8 11 11.25"/><path vector-effect="non-scaling-stroke" d="m9.25 3.25-2.5 9.5"/></g>`,
  },
  "rail-work": {
    viewBox: "0 0 16 16",
    body: `<g><rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1.2" fill="currentColor" fill-opacity="0.14"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="4.5" height="4.5" rx="1.2"/><rect vector-effect="non-scaling-stroke" x="9.25" y="2.25" width="4.5" height="4.5" rx="1.2"/><rect vector-effect="non-scaling-stroke" x="2.25" y="9.25" width="4.5" height="4.5" rx="1.2"/><path vector-effect="non-scaling-stroke" d="m9.5 11.75 1.5 1.5 3-3"/></g></g>`,
  },
  "rail-assistant": {
    viewBox: "0 0 16 16",
    body: `<g><rect x="2.5" y="2.5" width="9.5" height="11" rx="2" fill="currentColor" fill-opacity="0.1"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M9.5 2.5H4.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h5.5a2 2 0 0 0 2-2V7.5"/><path vector-effect="non-scaling-stroke" d="M5.25 6.5h3"/><path vector-effect="non-scaling-stroke" d="M5.25 9.5h4.5"/><path vector-effect="non-scaling-stroke" d="M12.25 1.5c0 1.5.75 2.25 2.25 2.25-1.5 0-2.25.75-2.25 2.25 0-1.5-.75-2.25-2.25-2.25 1.5 0 2.25-.75 2.25-2.25Z" fill="currentColor"/></g></g>`,
  },
  "rail-custom": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="1.75" y="1.75" width="4.5" height="4.5" rx="1"/><rect vector-effect="non-scaling-stroke" x="9.75" y="1.75" width="4.5" height="4.5" rx="1"/><rect vector-effect="non-scaling-stroke" x="5.75" y="9.75" width="4.5" height="4.5" rx="1"/><path vector-effect="non-scaling-stroke" d="M4 6.25v1.5h8v-1.5M8 7.75v2"/></g>`,
  },
  lock: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="3.25" y="7" width="9.5" height="6.75" rx="1.5"/><path vector-effect="non-scaling-stroke" d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2"/><path vector-effect="non-scaling-stroke" d="M8 9.75v1.25"/></g>`,
  },
  globe: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="6"/><ellipse vector-effect="non-scaling-stroke" cx="8" cy="8" rx="2.6" ry="6"/><path vector-effect="non-scaling-stroke" d="M2.25 8h11.5"/></g>`,
  },
  "select-element": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M12.5 6.75V3.75a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5V11a1.5 1.5 0 0 0 1.5 1.5h3"/><path vector-effect="non-scaling-stroke" d="m7.75 7.75 6 2.1-2.5 1-1 2.5-2.5-5.6Z"/></g>`,
  },
  flask: {
    viewBox: "0 0 16 16",
    body: `<g><path d="M4.3 9.5h7.4l1.55 2.8a1 1 0 0 1-.87 1.45H3.62a1 1 0 0 1-.87-1.45L4.3 9.5Z" fill="currentColor" fill-opacity="0.14"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M5.75 2.25h4.5M6.5 2.25v3.8L2.75 12.3a1 1 0 0 0 .87 1.45h8.76a1 1 0 0 0 .87-1.45L9.5 6.05v-3.8M4.3 9.5h7.4"/></g></g>`,
  },
  edit: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M7.75 2.75H3.75A1.5 1.5 0 0 0 2.25 4.25v8a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-4"/><path vector-effect="non-scaling-stroke" d="m11.9 2.1 2 2L8.25 9.75H6.25v-2L11.9 2.1Z"/></g>`,
  },
  "folder-add-left": {
    viewBox: "0 0 16 16",
    body: `<g><path d="M2 4a1.25 1.25 0 0 1 1.25-1.25h3.1l1.5 1.75H12.75A1.25 1.25 0 0 1 14 5.75v6.25a1.25 1.25 0 0 1-1.25 1.25H3.25A1.25 1.25 0 0 1 2 12V4Z" fill="currentColor" fill-opacity="0.08"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M8.5 13.25H3.25A1.25 1.25 0 0 1 2 12V4a1.25 1.25 0 0 1 1.25-1.25h3.1l1.5 1.75H12.75A1.25 1.25 0 0 1 14 5.75v2"/><path vector-effect="non-scaling-stroke" d="M12 9.5v4.5M9.75 11.75h4.5"/></g></g>`,
  },
  folder: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2 4.25A1.5 1.5 0 0 1 3.5 2.75h2.85a1 1 0 0 1 .78.38l1.12 1.37h4.25A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.25Z"/></g>`,
  },
  "folder-open": {
    viewBox: "0 0 16 16",
    body: `<g><path d="m2.2 12.75 1.4-5.25A1 1 0 0 1 4.55 6.75h8.7a.8.8 0 0 1 .77 1l-1.35 5a1 1 0 0 1-.97.75H3A.8.8 0 0 1 2.2 12.75Z" fill="currentColor" fill-opacity="0.12"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2 12.5V4.25A1.5 1.5 0 0 1 3.5 2.75h2.85a1 1 0 0 1 .78.38l1.12 1.37H12a1.5 1.5 0 0 1 1.5 1.5v.75"/><path vector-effect="non-scaling-stroke" d="m2.2 12.75 1.4-5.25A1 1 0 0 1 4.55 6.75h8.7a.8.8 0 0 1 .77 1l-1.35 5a1 1 0 0 1-.97.75H3A.8.8 0 0 1 2.2 12.75Z"/></g></g>`,
  },
  branch: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line vector-effect="non-scaling-stroke" x1="4.75" y1="5.5" x2="4.75" y2="10.5"/><circle vector-effect="non-scaling-stroke" cx="4.75" cy="3.75" r="1.75"/><circle vector-effect="non-scaling-stroke" cx="11.25" cy="4.75" r="1.75"/><circle vector-effect="non-scaling-stroke" cx="4.75" cy="12.25" r="1.75"/><path vector-effect="non-scaling-stroke" d="M11.25 6.5v1.25a2.5 2.5 0 0 1-2.5 2.5H4.75"/></g>`,
  },
  "branch-out": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m10.75 3.25 2.5 2.5-2.5 2.5"/><path vector-effect="non-scaling-stroke" d="M1.75 12h2.75a2.5 2.5 0 0 0 2.1-1.15l2.3-3.7A2.5 2.5 0 0 1 11 6h2.25"/><path vector-effect="non-scaling-stroke" d="M8.75 12h4.5"/></g>`,
  },
  "grid-plus": {
    viewBox: "0 0 16 16",
    body: `<g><rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" fill="currentColor" fill-opacity="0.14"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="4.5" height="4.5" rx="1"/><rect vector-effect="non-scaling-stroke" x="9.25" y="2.25" width="4.5" height="4.5" rx="1"/><rect vector-effect="non-scaling-stroke" x="2.25" y="9.25" width="4.5" height="4.5" rx="1"/><path vector-effect="non-scaling-stroke" d="M11.5 9.25v4.5M9.25 11.5h4.5"/></g></g>`,
  },
  help: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="6"/><path vector-effect="non-scaling-stroke" d="M6.4 6.25a1.65 1.65 0 0 1 3.2.55c0 1.1-1.6 1.45-1.6 2.45"/><circle vector-effect="non-scaling-stroke" cx="8" cy="11.35" r="0.65" fill="currentColor" stroke="none"/></g>`,
  },
  info: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="6"/><path vector-effect="non-scaling-stroke" d="M8 7.25v3.75"/><circle vector-effect="non-scaling-stroke" cx="8" cy="4.85" r="0.65" fill="currentColor" stroke="none"/></g>`,
  },
  "circle-exclamation": {
    viewBox: "0 0 16 16",
    body: `<g><circle cx="8" cy="8" r="6" fill="currentColor" fill-opacity="0.1"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="6"/><path vector-effect="non-scaling-stroke" d="M8 5v3.5"/><circle vector-effect="non-scaling-stroke" cx="8" cy="11" r="0.7" fill="currentColor" stroke="none"/></g></g>`,
  },
  "circle-xmark": {
    viewBox: "0 0 16 16",
    body: `<g><circle cx="8" cy="8" r="6" fill="currentColor" fill-opacity="0.14"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="6"/><path vector-effect="non-scaling-stroke" d="m10 6-4 4M6 6l4 4"/></g></g>`,
  },
  "sidebar-right": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.5" width="11.5" height="11" rx="1.75"/><line vector-effect="non-scaling-stroke" x1="9.75" y1="2.5" x2="9.75" y2="13.5"/></g>`,
  },
  status: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75"/><path vector-effect="non-scaling-stroke" d="M2.25 8h11.5M4.75 5.1h3M4.75 10.9h3"/></g>`,
  },
  "status-active": {
    viewBox: "0 0 16 16",
    body: `<g><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75" fill="currentColor" fill-opacity="0.14"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75"/><path vector-effect="non-scaling-stroke" d="M2.25 8h11.5M4.75 5.1h3M4.75 10.9h3"/></g></g>`,
  },
  "magnifying-glass": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="7" cy="7" r="4.5"/><path vector-effect="non-scaling-stroke" d="m10.25 10.25 3.5 3.5"/></g>`,
  },
  menu: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></g>`,
  },
  plus: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M8 3v10M3 8h10"/></g>`,
  },
  "settings-gear": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="2.1"/><path vector-effect="non-scaling-stroke" d="M9.1 1.75h-2.2l-.35 1.45a4.8 4.8 0 0 0-1.15.66l-1.4-.45-1.1 1.9 1.06 1a4.9 4.9 0 0 0 0 1.38l-1.06 1 1.1 1.9 1.4-.45c.35.27.73.5 1.15.66l.35 1.45h2.2l.35-1.45a4.8 4.8 0 0 0 1.15-.66l1.4.45 1.1-1.9-1.06-1a4.9 4.9 0 0 0 0-1.38l1.06-1-1.1-1.9-1.4.45a4.8 4.8 0 0 0-1.15-.66L9.1 1.75Z"/></g>`,
  },
  "chevron-down": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m4.5 6.25 3.5 3.5 3.5-3.5"/></g>`,
  },
  collapse: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M8 1.75V5.5M10.5 3.25 8 5.5 5.5 3.25"/><path vector-effect="non-scaling-stroke" d="M8 14.25V10.5M10.5 12.75 8 10.5l-2.5 2.25"/><path vector-effect="non-scaling-stroke" d="M4 8h1.5M7.25 8h1.5M10.5 8H12"/></g>`,
  },
  check: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m3.25 8.25 3.1 3.1 6.4-6.7"/></g>`,
  },
  monitor: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2" y="2.5" width="12" height="8.5" rx="1.5"/><path vector-effect="non-scaling-stroke" d="M5.5 13.5h5M8 11v2.5"/></g>`,
  },
  "workspace-new": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2.25 5.25v-2a1 1 0 0 1 1-1h2M10.75 2.25h2a1 1 0 0 1 1 1v2M13.75 10.75v2a1 1 0 0 1-1 1h-2M5.25 13.75h-2a1 1 0 0 1-1-1v-2"/><path vector-effect="non-scaling-stroke" d="M8 5.25v5.5M5.25 8h5.5"/></g>`,
  },
  "workspace-isolated": {
    viewBox: "0 0 16 16",
    body: `<g><path d="M8 4.75 11.25 6.5v3L8 11.25 4.75 9.5v-3L8 4.75Z" fill="currentColor" fill-opacity="0.18"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="11.5" height="11.5" rx="2"/><path vector-effect="non-scaling-stroke" d="M8 4.75 11.25 6.5v3L8 11.25 4.75 9.5v-3L8 4.75Z"/></g></g>`,
  },
  workspace: {
    viewBox: "0 0 16 16",
    body: `<g><rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" fill="currentColor" fill-opacity="0.2"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2.25 5.25v-2a1 1 0 0 1 1-1h2M10.75 2.25h2a1 1 0 0 1 1 1v2M13.75 10.75v2a1 1 0 0 1-1 1h-2M5.25 13.75h-2a1 1 0 0 1-1-1v-2"/><rect vector-effect="non-scaling-stroke" x="5.25" y="5.25" width="5.5" height="5.5" rx="1"/></g></g>`,
  },
  "outline-worktree": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m11.75 3.25 2.25 2.25-2.25 2.25"/><path vector-effect="non-scaling-stroke" d="M14 5.5H9.75L5.25 11.5H2"/><path vector-effect="non-scaling-stroke" d="M8.5 11.5H14"/></g>`,
  },
  "outline-trash": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2.5 4.25h11"/><path vector-effect="non-scaling-stroke" d="M5.75 4.25V3a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.25"/><path vector-effect="non-scaling-stroke" d="M12 4.25v8.25a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.5V4.25"/><path vector-effect="non-scaling-stroke" d="M6.75 7.25v3.75M9.25 7.25v3.75"/></g>`,
  },
  close: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M12 4 4 12M4 4l8 8"/></g>`,
  },
  "xmark-small": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m11.25 4.75-6.5 6.5M4.75 4.75l6.5 6.5"/></g>`,
  },
  "outline-xmark": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m10.75 5.25-5.5 5.5M5.25 5.25l5.5 5.5"/></g>`,
  },
  "outline-chevron-down": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="m4.5 6.25 3.5 3.5 3.5-3.5"/></g>`,
  },
  "outline-dots": {
    viewBox: "0 0 16 16",
    body: `<g fill="currentColor"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></g>`,
  },
  expand: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M8 5.5V1.75M10.5 4 8 1.75 5.5 4"/><path vector-effect="non-scaling-stroke" d="M8 10.5v3.75M10.5 12 8 14.25 5.5 12"/><path vector-effect="non-scaling-stroke" d="M3.5 8h9"/></g>`,
  },
  filetree: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M3 2.25v9.5h3.5M3 5.5h3.5"/><rect vector-effect="non-scaling-stroke" x="8.25" y="3.75" width="5.5" height="3" rx="0.75"/><rect vector-effect="non-scaling-stroke" x="8.25" y="10.25" width="5.5" height="3" rx="0.75"/></g>`,
  },
  split: {
    viewBox: "0 0 16 16",
    body: `<g><rect x="3.5" y="4.25" width="3.25" height="7.5" rx="0.6" fill="currentColor" fill-opacity="0.3"/><rect x="9.25" y="4.25" width="3.25" height="7.5" rx="0.6" fill="currentColor" fill-opacity="0.3"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2" y="2.5" width="12" height="11" rx="1.75"/><line vector-effect="non-scaling-stroke" x1="8" y1="2.5" x2="8" y2="13.5"/></g></g>`,
  },
  unified: {
    viewBox: "0 0 16 16",
    body: `<g><rect x="3.75" y="4.25" width="8.5" height="2.75" rx="0.6" fill="currentColor" fill-opacity="0.3"/><rect x="3.75" y="9" width="8.5" height="2.75" rx="0.6" fill="currentColor" fill-opacity="0.3"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2" y="2.5" width="12" height="11" rx="1.75"/><line vector-effect="non-scaling-stroke" x1="2" y1="8" x2="14" y2="8"/></g></g>`,
  },
  review: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75"/><path vector-effect="non-scaling-stroke" d="M8 4.75v4.5M5.75 7h4.5M5.75 11.25h4.5"/></g>`,
  },
  "window-analytics": {
    viewBox: "0 0 16 16",
    body: `<g><rect x="9.25" y="2.5" width="4.5" height="4.5" rx="1" fill="currentColor" fill-opacity="0.16"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M13.75 9.5v2.75a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5V4a1.5 1.5 0 0 1 1.5-1.5H7"/><rect vector-effect="non-scaling-stroke" x="9.25" y="2.5" width="4.5" height="4.5" rx="1"/><path vector-effect="non-scaling-stroke" d="M5 10.75v-2M7.5 10.75v-3.5M10 10.75v-1.25"/></g></g>`,
  },
  "graduation-cap": {
    viewBox: "0 0 16 16",
    body: `<g><path d="M8 2.5 1.75 5.75 8 9l6.25-3.25L8 2.5Z" fill="currentColor" fill-opacity="0.12"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M8 2.5 1.75 5.75 8 9l6.25-3.25L8 2.5Z"/><path vector-effect="non-scaling-stroke" d="M14 6v4.25"/><path vector-effect="non-scaling-stroke" d="M4 7.25v3.5c0 1.1 1.8 2.25 4 2.25s4-1.15 4-2.25v-3.5"/></g></g>`,
  },
  "code-slash": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M4.75 5 1.75 8l3 3M11.25 5l3 3-3 3M9.25 3.25l-2.5 9.5"/></g>`,
  },
  trash: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2.5 4.25h11"/><path vector-effect="non-scaling-stroke" d="M5.75 4.25V3a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.25"/><path vector-effect="non-scaling-stroke" d="M12 4.25v8.25a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.5V4.25"/><path vector-effect="non-scaling-stroke" d="M6.75 7.25v3.75M9.25 7.25v3.75"/></g>`,
  },
  "outline-sliders": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2 5h5.25M10.75 5H14"/><circle vector-effect="non-scaling-stroke" cx="9" cy="5" r="1.75"/><path vector-effect="non-scaling-stroke" d="M2 11h3.25M8.75 11H14"/><circle vector-effect="non-scaling-stroke" cx="7" cy="11" r="1.75"/></g>`,
  },
  "outline-copy": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="5.5" y="5.5" width="8.25" height="8.25" rx="1.5"/><path vector-effect="non-scaling-stroke" d="M3.5 10.5h-.25a1.5 1.5 0 0 1-1.5-1.5V3.75a1.5 1.5 0 0 1 1.5-1.5H8.5a1.5 1.5 0 0 1 1.5 1.5V4"/></g>`,
  },
  "outline-arrow-left": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M13 8H3M7 4 3 8l4 4"/></g>`,
  },
  "outline-arrow-right": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M3 8h10M9 4l4 4-4 4"/></g>`,
  },
  "outline-arrow-up-right": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M4 12 12 4M6 4h6v6"/></g>`,
  },
  "outline-rotate-clockwise": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M13.25 6.25A5.5 5.5 0 1 0 13.5 9"/><path vector-effect="non-scaling-stroke" d="M13.25 2.75v3.5h-3.5"/></g>`,
  },
  "outline-globe": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="6"/><ellipse vector-effect="non-scaling-stroke" cx="8" cy="8" rx="2.5" ry="6"/><path vector-effect="non-scaling-stroke" d="M2.6 5.75h10.8M2.6 10.25h10.8"/></g>`,
  },
  "outline-globe-plus": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M7.5 13.75A5.75 5.75 0 1 1 13.25 8"/><path vector-effect="non-scaling-stroke" d="M7.5 2.25c-1.4 0-2.5 2.57-2.5 5.75s1.1 5.75 2.5 5.75M9.8 6.5C9.55 4.05 8.62 2.25 7.5 2.25"/><path vector-effect="non-scaling-stroke" d="M2 7.5h10.5"/><path vector-effect="non-scaling-stroke" d="M12 10v4M10 12h4"/></g>`,
  },
  "outline-cookie": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M13.75 8.5A5.75 5.75 0 1 1 7.5 2.25a2 2 0 0 0 2.4 2.4 2 2 0 0 0 2.4 2.4c.38.58.86 1.06 1.45 1.45Z"/><path vector-effect="non-scaling-stroke" d="M5.5 6.5h.01M5.75 10h.01M8.5 8.75h.01M10.25 11h.01"/></g>`,
  },
  "outline-browser-annotate": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M10.75 2.25h2a1 1 0 0 1 1 1v2M2.25 5.25v-2a1 1 0 0 1 1-1h2M2.25 10.75v2a1 1 0 0 0 1 1h2"/><path vector-effect="non-scaling-stroke" d="m7 7 6.5 2.15-2.75 1.1-1.1 2.75L7 7Z"/></g>`,
  },
  "arrow-up-right": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10"/></g>`,
  },
  "outline-square-arrow": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M13 8.75v3.5a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4.5 3.75H8"/><path vector-effect="non-scaling-stroke" d="M10 2.25h3.75V6M13.5 2.5 7.75 8.25"/></g>`,
  },
  "outline-arrow-to-corner-top-right": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75"/><path vector-effect="non-scaling-stroke" d="M6.25 5.5h4.25v4.25M10.25 5.75l-4.75 4.75"/></g>`,
  },
  "outline-hexagonal-warning": {
    viewBox: "0 0 16 16",
    body: `<g><path d="M5.6 2h4.8L14 5.6v4.8L10.4 14H5.6L2 10.4V5.6L5.6 2Z" fill="currentColor" fill-opacity="0.1"/><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M5.6 2h4.8L14 5.6v4.8L10.4 14H5.6L2 10.4V5.6L5.6 2Z"/><path vector-effect="non-scaling-stroke" d="M8 5.25v3.25"/><circle vector-effect="non-scaling-stroke" cx="8" cy="11" r="0.65" fill="currentColor" stroke="none"/></g></g>`,
  },
  "outline-share": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M8 10V2.5M5.25 5.25 8 2.5l2.75 2.75"/><path vector-effect="non-scaling-stroke" d="M2.75 9.75v2.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-2.5"/></g>`,
  },
  "outline-eye": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M1.75 8S4.25 3.75 8 3.75 14.25 8 14.25 8 11.75 12.25 8 12.25 1.75 8 1.75 8Z"/><circle vector-effect="non-scaling-stroke" cx="8" cy="8" r="2"/></g>`,
  },
  "outline-eye-slash": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M6.6 6.6a2 2 0 0 0 2.8 2.8"/><path vector-effect="non-scaling-stroke" d="M10.7 10.7C9.9 11.2 9 11.5 8 11.5c-3.75 0-6.25-3.5-6.25-3.5a11.7 11.7 0 0 1 3.1-3.1M6.3 4.65A5.8 5.8 0 0 1 8 4.5c3.75 0 6.25 3.5 6.25 3.5a11.8 11.8 0 0 1-1.65 2.05"/><path vector-effect="non-scaling-stroke" d="m2.5 2.5 11 11"/></g>`,
  },
  refresh: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M13.25 6.25A5.5 5.5 0 1 0 13.5 9"/><path vector-effect="non-scaling-stroke" d="M13.25 2.75v3.5h-3.5"/></g>`,
  },
  reset: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M4.75 3.5 2 6.25 4.75 9"/><path vector-effect="non-scaling-stroke" d="M2.25 6.25h7.5a3.75 3.75 0 0 1 0 7.5H7.5"/></g>`,
  },
  "outline-undo": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M2.5 8.5 4.4 6.6a5.5 5.5 0 0 1 8.85 1.9"/><path vector-effect="non-scaling-stroke" d="M2.5 5v3.5H6"/></g>`,
  },
  "outline-reset": {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M4.75 3.5 2 6.25 4.75 9"/><path vector-effect="non-scaling-stroke" d="M2.25 6.25h7.5a3.75 3.75 0 0 1 0 7.5H7.5"/></g>`,
  },
  "fill-triangle-down": {
    viewBox: "0 0 16 16",
    body: `<path d="M5.2 6.2c-.35 0-.55.4-.35.7l2.8 4.1c.2.28.5.28.7 0l2.8-4.1c.2-.3 0-.7-.35-.7H5.2Z" fill="currentColor"/>`,
  },
  archive: {
    viewBox: "0 0 16 16",
    body: `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect vector-effect="non-scaling-stroke" x="1.75" y="2.5" width="12.5" height="3" rx="0.8"/><path vector-effect="non-scaling-stroke" d="M3 5.5v6.75a1.25 1.25 0 0 0 1.25 1.25h7.5A1.25 1.25 0 0 0 13 12.25V5.5"/><path vector-effect="non-scaling-stroke" d="M6.5 8.25h3"/></g>`,
  },
} as const

export type IconName = keyof typeof icons | keyof typeof additionalIcons

/** The artwork catalog's names, in sprite order. */
export function iconNames() {
  // SAFETY: every key comes from one of the two artwork records that define IconName.
  return Array.from(new Set([...Object.keys(additionalIcons), ...Object.keys(icons)])) as IconName[]
}

/**
 * Narrows a name against the shared artwork catalog.
 * @param name - A name supplied by a caller, including names unknown to this build.
 */
export function isIconName(name: string): name is IconName {
  return Object.hasOwn(icons, name) || Object.hasOwn(additionalIcons, name)
}

/**
 * The SVG body and viewport for a known catalog name, with primary artwork taking precedence.
 * @param name - A name validated by the type or by `isIconName`.
 */
export function getIcon(name: IconName) {
  // SAFETY: IconName is the union of both catalogs' keys; an absent primary entry falls back to additional artwork.
  const icon = icons[name as keyof typeof icons]

  if (icon) return icon
  // SAFETY: the primary lookup ruled out its entries, so the remaining name belongs to additionalIcons.
  const key = name as keyof typeof additionalIcons

  return { body: additionalIcons[key], viewBox: additionalIconViewBox(key) }
}

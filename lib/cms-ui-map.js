/**
 * Authoritative CMS UI layout for the Lango assistant.
 * Keep in sync with public/cms.html and public/cms.js.
 */

const CMS_TOP_NAV = [
  {
    label: "Home",
    screen: "home",
    purpose: "Starting hub with task shortcuts to My courses, Community, class progress, and Host.",
  },
  {
    label: "My courses",
    screen: "list",
    purpose: "Open the course library, create new courses, import/export backups, share to Community.",
  },
  {
    label: "Community",
    screen: "community",
    purpose: "Browse public courses from other teachers. Preview, add to My courses, or report. Share your own course from My courses → Details.",
  },
  { label: "Host", href: "/host.html", purpose: "Run a live class session with students." },
  {
    label: "Previews",
    purpose: "Dropdown with Student preview and Host preview links.",
  },
  { label: "Notifications", href: "/config.html", purpose: "Open notification settings." },
];

const CMS_ASSISTANT = {
  openButton: "Ask Lango",
  location: "Floating button at the bottom-right of every CMS page (after login).",
  closeButton: "× in the assistant panel header.",
};

const CMS_SCREENS = {
  login: {
    heading: "Sign in",
    purpose: "Teacher login before using the CMS.",
    actions: [{ label: "Login", type: "button", note: "Primary button on the sign-in card." }],
  },
  home: {
    heading: "What do you want to do?",
    purpose: "CMS starting page with shortcuts to common tasks.",
    actions: [
      {
        label: "Create a new course",
        type: "card button",
        result: "Opens the course editor on a new course.",
      },
      {
        label: "Edit my courses",
        type: "card button",
        result: "Opens My courses.",
      },
      {
        label: "Browse Community",
        type: "card button",
        result: "Opens Community.",
      },
      {
        label: "Track class progress",
        type: "card button",
        result: "Opens Class progress (formerly Dashboard).",
      },
    ],
  },
  dashboard: {
    heading: "Class progress",
    purpose: "Track where the selected class is in each course journey.",
    actions: [
      {
        label: "Class",
        type: "dropdown",
        note: "Top-right class picker on this page only.",
      },
    ],
    notHere: [
      'There is no "Create Course" or "New course" button on Dashboard.',
      "To create a course, go to My courses in the top bar.",
    ],
  },
  list: {
    heading: "My courses",
    purpose: "Library of courses to open, edit, import, or export.",
    actions: [
      {
        label: "New course",
        type: "primary button",
        location: "Top-right of the page header (shows a + glyph).",
        result: "Creates a course and opens the course editor on the Details tab.",
      },
      { label: "Import all", type: "secondary button" },
      { label: "Export all", type: "secondary button" },
    ],
  },
  community: {
    heading: "Community",
    purpose: "Public course catalog shared by teachers.",
    actions: [
      { label: "Search", type: "search field", location: "Top of the Community page." },
      { label: "Language", type: "dropdown" },
      { label: "Sort", type: "dropdown", note: "Featured, Newest, or Most added." },
      { label: "Preview", type: "button", location: "On each community course card." },
      {
        label: "Add to My courses",
        type: "primary button",
        location: "On each community course card or in the preview dialog.",
        result: "Copies the public snapshot into My courses without replacing existing courses.",
      },
      { label: "Report", type: "button", note: "Not shown on your own listings. Three reports hide the listing." },
      { label: "Unshare", type: "button", note: "Shown only on listings you published." },
    ],
  },
  edit: {
    backLink: "All courses",
    tabs: [
      {
        label: "Details",
        id: "details",
        fields: ["Course name", "Description", "Course thumbnail", "Assigned classes"],
        actions: [
          { label: "Save details", type: "primary button" },
          { label: "Export course", type: "secondary button" },
          {
            label: "Share to Community",
            type: "secondary button",
            note: "Publishes a public snapshot. Becomes Update Community listing after sharing. Hidden for courses copied from Community.",
          },
          { label: "Unshare", type: "secondary button", note: "Removes the public listing. Hidden until the course is shared." },
          { label: "Delete course", type: "danger button" },
        ],
        extra: [
          {
            label: "Feature this listing in Community",
            type: "checkbox",
            location: "Above the Details action row.",
          },
        ],
      },
      {
        label: "Sections",
        id: "sections",
        subviews: ["sections list", "section exercises (playlist)"],
        actions: [
          { label: "Add section", type: "button", location: "Bottom of the section list." },
          { label: "Save sections", type: "primary button" },
          { label: "Edit", type: "button", location: "On each section card — opens that section's exercise playlist." },
        ],
        batchAi: {
          summary: "Batch AI Generate (all sections)",
          location: "Collapsible panel above the section list when expanded.",
        },
      },
    ],
    exercisesSubview: {
      heading: "Section exercises",
      actions: [
        { label: "Edit", type: "button", location: "On each exercise row — opens the question editor." },
        { label: "Done", type: "button", note: "Shown when an exercise is expanded." },
        { label: "Save exercises", type: "primary button", note: "Appears after exercises exist." },
        { label: "Preview all student layouts", type: "link" },
      ],
      aiPanel: {
        label: "Generate with AI",
        entryChoices: [
          { label: "Add to this section", purpose: "Generate exercises for the open section only." },
          {
            label: "Build full course from document",
            purpose: "Split one document into multiple sections, then generate.",
          },
        ],
        wizardSteps: ["Format", "Material", "Review", "Publish"],
        wizardNav: ["Back", "Continue", "Continue to publish", "Publish to section / Publish course"],
        reviewHint: "Use Ask Lango (bottom-right) to revise generated questions on step 3 Review.",
      },
    },
  },
};

const CMS_FLOWS = {
  createCourse: {
    title: "Create a new course",
    steps: [
      'Click **My courses** in the top navigation bar (not Dashboard).',
      'On **My courses**, click the primary **New course** button (top-right, + icon).',
      'You land on **Edit course** → **Details** tab. Enter **Course name** and **Description**.',
      'Click **Save details**.',
      'Open the **Sections** tab → **Add section** → name your sections → **Save sections**.',
      'On a section card, click **Edit** to build exercises (manually or via **Generate with AI**).',
    ],
  },
  generateExercises: {
    title: "Generate exercises with AI (one section)",
    steps: [
      'Open a course → **Sections** tab → click **Edit** on a section.',
      'In the **Generate with AI** panel, choose **Add to this section**.',
      'Wizard: **Format** (pick template) → **Material** (paste/upload) → **Review** → **Publish**.',
      'On Review, use **Ask Lango** to tweak questions before publishing.',
    ],
  },
  hostClass: {
    title: "Host a class",
    steps: [
      "Finish building and saving your course sections/exercises.",
      'Click **Host** in the top navigation bar to open the host page.',
    ],
  },
  shareCommunity: {
    title: "Share a course to Community",
    steps: [
      "Open the course in **My courses**.",
      "On the **Details** tab, optionally check **Feature this listing in Community**.",
      "Click **Share to Community**. This publishes a snapshot — later edits to your private course do not update the listing until you click **Update Community listing**.",
      "Courses added from Community with **Add to My courses** cannot be shared again.",
      "To remove it, click **Unshare** on Details or on your card in **Community**.",
    ],
  },
  copyCommunity: {
    title: "Add a Community course to My courses",
    steps: [
      "Click **Community** in the top navigation bar.",
      "Search or filter, then click **Preview** or **Add to My courses**.",
      "The copy appears in **My courses**. It does not replace your other courses.",
    ],
  },
};

function pickFlowsForContext(context) {
  const screen = String(context?.screen || "");
  const tab = String(context?.tab || "");
  const subview = String(context?.subview || "");
  const flows = [];

  if (screen === "home" || screen === "dashboard" || screen === "list" || (screen === "edit" && tab === "details" && !context?.course?.id)) {
    flows.push(CMS_FLOWS.createCourse);
  }
  if (screen === "edit" && (subview === "exercises" || tab === "sections")) {
    flows.push(CMS_FLOWS.generateExercises);
  }
  if (screen === "community") {
    flows.push(CMS_FLOWS.copyCommunity);
    flows.push(CMS_FLOWS.shareCommunity);
  }
  if (screen === "list" || (screen === "edit" && tab === "details")) {
    flows.push(CMS_FLOWS.shareCommunity);
  }
  if (screen !== "login") {
    flows.push(CMS_FLOWS.hostClass);
  }
  return flows;
}

function getScreenSlice(context) {
  const screen = String(context?.screen || "unknown");
  if (screen === "edit") {
    const tab = String(context?.tab || "details");
    const subview = String(context?.subview || "");
    const slice = {
      screen: "edit",
      backLink: CMS_SCREENS.edit.backLink,
      activeTab: tab,
      tabDetails: tab === "details" ? CMS_SCREENS.edit.tabs[0] : null,
      tabSections: tab === "sections" ? CMS_SCREENS.edit.tabs[1] : null,
    };
    if (subview === "exercises") {
      slice.exercisesSubview = CMS_SCREENS.edit.exercisesSubview;
      slice.aiWizardStep = context?.wizardStep || null;
    }
    if (context?.course?.name) {
      slice.courseName = context.course.name;
    }
    return slice;
  }
  return CMS_SCREENS[screen] || { screen, note: "Unknown screen." };
}

function getUiGuidance(context) {
  const mode = String(context?.mode || "general");
  const screen = String(context?.screen || "unknown");
  const pageHeading = context?.pageHeading || null;

  const lines = [
    "UI MAP (use these exact labels — do not invent buttons):",
    `Top nav: ${CMS_TOP_NAV.map((item) => item.label).join(" · ")}`,
    `Assistant: ${CMS_ASSISTANT.openButton} — ${CMS_ASSISTANT.location}`,
  ];

  if (pageHeading) {
    lines.push(`Visible page heading: "${pageHeading}"`);
  }

  if (screen === "home") {
    lines.push(
      'Home is the starting hub. Use the cards: **Create a new course**, **Edit my courses**, **Browse Community**, or **Track class progress**.'
    );
  }

  if (screen === "dashboard") {
    lines.push('Class progress has no "New course" button. Send the teacher to Home or My courses first.');
  }

  if (screen === "list") {
    lines.push('To create a course: click **New course** (top-right). Do not say "Create Course". Share a course from Details with **Share to Community**.');
  }

  if (screen === "community") {
    lines.push(
      "Community is the public catalog. Use **Add to My courses** to copy a listing. To publish your own, go to My courses → Details → **Share to Community**."
    );
  }

  const slice = getScreenSlice(context);
  lines.push("Current screen UI:", JSON.stringify(slice, null, 2));

  const flows = pickFlowsForContext(context);
  if (flows.length) {
    lines.push(
      "Relevant step-by-step flows:",
      flows.map((flow) => `${flow.title}:\n${flow.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`).join("\n\n")
    );
  }

  if (mode === "exercise-edit") {
    lines.push(
      "Exercise edit mode: teacher has an exercise expanded. They can highlight text and use Add to chat, or type revisions in Ask Lango."
    );
  }
  if (mode === "ai-review") {
    lines.push(
      "AI review mode: wizard step 3 (Review). Teacher can highlight generated questions and revise via Ask Lango."
    );
  }

  return lines.join("\n");
}

function buildAssistantSystemPrompt(context) {
  const screen = String(context?.screen || "unknown");
  const tab = String(context?.tab || "");
  const subview = String(context?.subview || "");
  const mode = String(context?.mode || "general");

  return (
    "You are Lango CMS Assistant — a concise, practical helper for language teachers using the LangoClass Course CMS. " +
    "Answer in clear steps with exact UI labels from the UI MAP in the user message. " +
    "NEVER invent buttons (there is no 'Create Course' — the button is 'New course' on My courses). " +
    "Home is the CMS starting page with task shortcuts. Class progress is under Track class progress on Home. " +
    "Top nav items are: Home, My courses, Community, Host, Previews, Notifications. " +
    "The in-app assistant is opened via the bottom-right 'Ask Lango' button. " +
    "When the teacher asks to change quiz content in exercise-edit or ai-review mode, they can describe the edit in Ask Lango (revisions apply automatically). " +
    "Do not invent API endpoints. Do not claim you saved changes unless the user confirms Save or Publish happened. " +
    `Current screen: ${screen}. Tab: ${tab || "n/a"}. Subview: ${subview || "n/a"}. Mode: ${mode}.`
  );
}

module.exports = {
  CMS_TOP_NAV,
  CMS_ASSISTANT,
  CMS_SCREENS,
  CMS_FLOWS,
  getUiGuidance,
  getScreenSlice,
  buildAssistantSystemPrompt,
};

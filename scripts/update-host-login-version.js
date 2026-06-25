const fs = require("fs");
const path = require("path");

const hostPath = path.join(__dirname, "..", "public", "host.html");
const html = fs.readFileSync(hostPath, "utf8");

const now = new Date();
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
  .formatToParts(now)
  .reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
const version = `${parts.year}.${parts.month}.${parts.day}.${parts.hour}${parts.minute}${parts.second}.${milliseconds}`;
const nextHtml = html.replace(
  /<p class="login-version">Version [^<]*<\/p>/,
  `<p class="login-version">Version ${version}</p>`,
);

if (nextHtml === html) {
  throw new Error("Could not find the host login version marker in public/host.html");
}

fs.writeFileSync(hostPath, nextHtml);
console.log(version);

// The Lango characters that generated course images are drawn with. Each one is
// sent to the image router as a reference picture so it looks the same every
// time. No image libraries, so the Worker can use it.

// file is under public/; reference is a name the router knows by itself.
const CHARACTERS = [
  { id: "dan", file: "/assets/characters/dan.png", look: "orange curly hair, yellow top, teal overalls with a bear badge" },
  { id: "ryan", file: "/assets/characters/ryan.png", look: "spiky black hair, blue headband, red jacket" },
  { id: "chris", file: "/assets/characters/chris.png", look: "short blue hair, round glasses, red vest with a white shirt" },
  { id: "jessica", file: "/assets/characters/jessica.png", look: "long pink hair, blue headphones, light blue dress" },
  { id: "uncle-tommy", reference: "uncle-tommy", look: "grey hair and moustache, star-patterned blue wizard hat, blue and pink long coat" },
];

function pickCharacter(random = Math.random) {
  return CHARACTERS[Math.floor(random() * CHARACTERS.length) % CHARACTERS.length];
}

// Keeps who the character is (face, hair, outfit, colours) but not the flat
// front-view pose or the reference picture's own rendering, which made the
// character look pasted on top of the scene.
function characterLine(character) {
  return (
    `The character is the one in the reference image (${character.look}): keep the same face, hair, outfit and colours, ` +
    `but redraw it as part of this scene, not as a pasted-in picture. Render it in the same art style, lighting, shading, ` +
    `colour grading and level of detail as everything else, with its own natural pose and expression (not the stiff front-facing reference pose), ` +
    `a soft contact shadow on the ground, and light and colour bounced from the surroundings.`
  );
}

// A quiz picture: the character joins the scene, the quiz subject stays the focus.
function withCharacter(prompt, character) {
  const base = String(prompt || "").trim();
  if (!character || !base) return base;
  return (
    `${base} ${characterLine(character)} The character is reacting to or pointing at the subject, ` +
    `and the subject stays the clearest, most prominent thing in the picture. No text or lettering in the image.`
  );
}

module.exports = {
  CHARACTERS,
  pickCharacter,
  characterLine,
  withCharacter,
};

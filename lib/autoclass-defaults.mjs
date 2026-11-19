// Default banks for lesson scripts that leave them out (lib/autoclass-script.mjs). The wording rules:
// a line is played for any class size, so no numbers, no names, never blame, and each line is true
// for its bank ("most of you" only where it is at least 70%; "everyone" only if all answered and
// all were right). See public/autoclass-analysis.js for which bank is picked when.
export const DEFAULT_ANALYSIS = {
  "leadIn": [
    "Let's see how we did!",
    "Okay, time to check our answers!",
    "Here come the results!",
    "Let's look at your answers together!"
  ],
  "allRight": [
    "Wow! Every one of you got it right! Amazing!",
    "Perfect! You all got it right. Give yourselves a big clap!",
    "Hooray! Everyone got it right. You are super stars!",
    "Fantastic! Not one mistake. I am so proud of you!",
    "You all got it! What a great class!"
  ],
  "mostRight": [
    "Great job! Most of you got it right!",
    "Well done! Lots of you knew this one.",
    "Nice work! Most of the class got it.",
    "Very good! Many of you got it right.",
    "Super! Most of you are really getting this."
  ],
  "mixed": [
    "Some of you got it, and some were not sure. That's okay!",
    "Hmm, the answers were mixed this time. Let's keep learning together.",
    "About half of you got it. Good try, everyone!",
    "It was a bit tricky, wasn't it? That's how we learn!",
    "Good thinking, everyone! Some of you were very close."
  ],
  "mostWrong": [
    "That was a tricky one! Only a few of you got it. Let's remember it together.",
    "Oh, that was hard! Don't worry, mistakes help us learn.",
    "Not many got this one, but that's okay. Now we know it!",
    "A tricky question! Let's remember the answer together.",
    "Good try! This one is hard. We will practise more."
  ],
  "noneRight": [
    "Oh, that was a really tricky one! Nobody got it this time. But now we know the answer!",
    "No worries! That was hard. Let's remember it together.",
    "That's okay, everyone! Even I think it was tricky. Now we know!",
    "Nobody got it this time, but you all tried. Good job trying!"
  ],
  "noAnswers": [
    "Hmm, I didn't hear any answers this time. Let's try again on the next question!",
    "No answers this time. Don't be shy! Tap your answer next time.",
    "It looks like everyone was busy. Next time, tap your answer on your phone!",
    "I'm waiting for your answers! Let's try the next one."
  ],
  "singleRight": [
    "Nice one! You got it right!",
    "Well done! That's the right answer!",
    "You got it! Great job!"
  ],
  "singleWrong": [
    "Good try! Now you know the answer.",
    "Not this time, but that's okay. Let's remember it together.",
    "Nice try! Let's learn it together."
  ],
  "someSilent": [
    "Some friends didn't answer in time. That's okay. Try to be quick next time!",
    "A few of you missed this one. Next time, tap your answer before the time is up.",
    "Don't forget to tap your answer on your phone, okay?",
    "I think some friends were still thinking. Let's try a little faster next time!"
  ]
};

// "Right" for say-it-with-me only means the phone heard the sentence well, so nothing here may
// sound like a mistake.
export const DEFAULT_SPEAK_ANALYSIS = {
  "leadIn": [
    "Thank you for speaking! Let's have a look.",
    "Let's see how your speaking went!",
    "I was listening! Let's see."
  ],
  "allRight": [
    "Wow! You all said it so clearly!",
    "Amazing speaking, everyone! Give yourselves a clap!",
    "Perfect! Every one of you said it just right!"
  ],
  "mostRight": [
    "Great speaking! Most of you said it really well.",
    "Well done! I heard lots of clear voices.",
    "Super! Most of you said it just right."
  ],
  "mixed": [
    "Good speaking, everyone! Some of you were very close.",
    "Nice try, everyone! Speaking gets easier every time.",
    "Good job speaking up! Let's keep practising."
  ],
  "mostWrong": [
    "That was a long sentence! Good try, everyone.",
    "Speaking is hard, and you were brave to try!",
    "Nice work trying! Let's practise it again together."
  ],
  "noneRight": [
    "Good try, everyone! It was a long sentence. Let's practise more.",
    "That's okay! Speaking takes practice. You were brave to try!",
    "Sometimes the phone does not hear us well. Keep trying!"
  ],
  "noAnswers": [
    "Hmm, I didn't hear anyone this time. Next time, tap the microphone and say it!",
    "Don't be shy! Next time, tap the microphone on your phone and speak.",
    "I'm waiting to hear your voice! Let's try next time."
  ],
  "singleRight": [
    "Wonderful! You said it perfectly!",
    "Great speaking! That was so clear!",
    "Well done! You said it just right!"
  ],
  "singleWrong": [
    "Good try! You were very brave to speak.",
    "Nice try! Keep practising and it gets easier.",
    "Thank you for speaking! Let's practise it again."
  ],
  "someSilent": [
    "Some friends didn't speak this time. Next time, tap the microphone and try!",
    "Don't forget to tap the microphone and speak, okay?",
    "I hope to hear more voices next time!"
  ]
};

export const DEFAULT_TUTOR_LEAD_INS = [
  "Ooh, I see a hand up! Let me hear your question.",
  "Wait, wait! A friend has a question for me.",
  "Oh, someone has a question! Let me think."
];

export const DEFAULT_TUTOR_LEAD_OUTS = [
  "Great question! Now, back to our lesson.",
  "Thank you for asking! Let's keep going.",
  "I hope that helps! Now, where were we?"
];

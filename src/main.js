import { PitchController } from './audio/pitchController.js';
import { Game } from './game/game.js';

const canvas = document.getElementById('gameCanvas');
const startButton = document.getElementById('startButton');
const retryButton = document.getElementById('retryButton');
const overlay = document.getElementById('gameOverlay');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('finalScore');

const game = new Game(canvas, {
  onScore: (value) => {
    scoreEl.textContent = value.toString();
  },
  onGameOver: (value) => {
    finalScoreEl.textContent = value.toString();
    overlay.classList.remove('hidden');
    startButton.disabled = false;
  },
});

const pitchController = new PitchController({
  onValue: (normalized) => {
    game.setControlValue(normalized);
  },
});

async function beginGame() {
  try {
    startButton.disabled = true;
    await pitchController.start();
    overlay.classList.add('hidden');
    game.start();
  } catch (error) {
    console.error(error);
    startButton.disabled = false;
    alert('Mikrofon-Zugriff nicht möglich. Bitte erlaube Zugriff und versuche es erneut.');
  }
}

startButton.addEventListener('click', () => {
  beginGame();
});

retryButton.addEventListener('click', () => {
  overlay.classList.add('hidden');
  beginGame();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.stop();
  }
});

window.addEventListener('beforeunload', () => {
  pitchController.stop();
});

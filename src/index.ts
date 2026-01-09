import React, { useState, useEffect } from 'react';
import { AlertCircle, Trophy, Zap } from 'lucide-react';

// ============================================================================
// CONFIGURATION - Easy to adjust all game parameters
// ============================================================================
const CONFIG = {
  // Economy
  ATTEMPT_COST: 0.1, // WLD cost per attempt (CHANGE THIS VALUE TO ADJUST PRICING)
  
  // Maze settings
  MAZE_DURATION_HOURS: 12, // How long each maze lasts
  STEPS_PER_ATTEMPT: 25, // Number of steps in each attempt
  ATTEMPTS_PER_MAZE: 5, // Number of attempts allowed per maze
  
  // Difficulty curve parameters (adjust to change win probability)
  CURVE_EXPONENT: 3.5, // Higher = harder to reach 100% (exponential difficulty)
  BASE_MATCH_BONUS: 0.15, // Base score for each correct step
};

// ============================================================================
// MAZE GENERATION & EVALUATION LOGIC
// ============================================================================

/**
 * Generates a deterministic maze solution based on a seed (timestamp)
 * Returns an array of 25 directions: 0=Left, 1=Forward, 2=Right
 */
function generateMazeSolution(seed) {
  // Simple deterministic random using seed
  let rng = seed;
  const lcg = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };
  
  const solution = [];
  for (let i = 0; i < CONFIG.STEPS_PER_ATTEMPT; i++) {
    solution.push(Math.floor(lcg() * 3)); // 0, 1, or 2
  }
  return solution;
}

/**
 * Get the current maze seed (changes every 12 hours)
 */
function getCurrentMazeSeed() {
  const now = Date.now();
  const mazeEpoch = Math.floor(now / (CONFIG.MAZE_DURATION_HOURS * 60 * 60 * 1000));
  return mazeEpoch;
}

/**
 * Calculate how close the player's attempt is to the solution
 * Uses a non-linear curve to make 100% extremely difficult
 */
function evaluateAttempt(playerMoves, solution) {
  // Count consecutive correct moves from the start
  let consecutiveMatches = 0;
  for (let i = 0; i < CONFIG.STEPS_PER_ATTEMPT; i++) {
    if (playerMoves[i] === solution[i]) {
      consecutiveMatches++;
    } else {
      break; // Stop at first mismatch
    }
  }
  
  // Also count total matches (position-independent) for partial credit
  let totalMatches = 0;
  for (let i = 0; i < CONFIG.STEPS_PER_ATTEMPT; i++) {
    if (playerMoves[i] === solution[i]) {
      totalMatches++;
    }
  }
  
  // Weight consecutive matches heavily (path matters)
  const consecutiveRatio = consecutiveMatches / CONFIG.STEPS_PER_ATTEMPT;
  const totalRatio = totalMatches / CONFIG.STEPS_PER_ATTEMPT;
  
  // Combined score with exponential curve
  const baseScore = (consecutiveRatio * 0.7 + totalRatio * 0.3);
  
  // Apply exponential curve: makes reaching 100% exponentially harder
  // Formula: score^exponent * 100
  const curvedScore = Math.pow(baseScore, CONFIG.CURVE_EXPONENT) * 100;
  
  // Add small bonus for high match counts to avoid getting stuck at 99%
  let finalScore = curvedScore;
  if (totalMatches === CONFIG.STEPS_PER_ATTEMPT) {
    finalScore = 100; // Perfect match = guaranteed 100%
  } else if (totalMatches >= CONFIG.STEPS_PER_ATTEMPT * 0.9) {
    // Give diminishing bonus for near-perfect
    const bonus = (totalMatches - CONFIG.STEPS_PER_ATTEMPT * 0.9) / (CONFIG.STEPS_PER_ATTEMPT * 0.1) * 5;
    finalScore = Math.min(99.9, curvedScore + bonus);
  }
  
  return Math.round(finalScore * 10) / 10; // Round to 1 decimal
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

async function getPlayerData(mazeSeed) {
  try {
    const key = `player_maze_${mazeSeed}`;
    const result = await window.storage.get(key, false);
    if (result) {
      return JSON.parse(result.value);
    }
  } catch (e) {
    // Key doesn't exist
  }
  return { attemptsUsed: 0, bestScore: 0 };
}

async function savePlayerData(mazeSeed, data) {
  const key = `player_maze_${mazeSeed}`;
  await window.storage.set(key, JSON.stringify(data), false);
}

async function getLeaderboard(mazeSeed) {
  try {
    const key = `leaderboard_${mazeSeed}`;
    const result = await window.storage.get(key, true);
    if (result) {
      return JSON.parse(result.value);
    }
  } catch (e) {
    // Key doesn't exist
  }
  return [];
}

async function updateLeaderboard(mazeSeed, playerName, score) {
  let leaderboard = await getLeaderboard(mazeSeed);
  
  // Update or add player
  const existing = leaderboard.find(p => p.name === playerName);
  if (existing) {
    existing.score = Math.max(existing.score, score);
  } else {
    leaderboard.push({ name: playerName, score });
  }
  
  // Sort by score descending
  leaderboard.sort((a, b) => b.score - a.score);
  
  // Keep top 100
  leaderboard = leaderboard.slice(0, 100);
  
  const key = `leaderboard_${mazeSeed}`;
  await window.storage.set(key, JSON.stringify(leaderboard), true);
}

// ============================================================================
// MOCK WORLD APP SDK (Replace with real SDK in production)
// ============================================================================

const mockWorldSDK = {
  balance: 5.0, // Mock balance
  
  async getBalance() {
    return this.balance;
  },
  
  async deductFunds(amount) {
    if (this.balance >= amount) {
      this.balance -= amount;
      return true;
    }
    return false;
  },
  
  getUserName() {
    return `Player${Math.floor(Math.random() * 10000)}`;
  }
};

// ============================================================================
// MAIN GAME COMPONENT
// ============================================================================

export default function BlindMazeGame() {
  const [gameState, setGameState] = useState('menu'); // menu, playing, result
  const [currentStep, setCurrentStep] = useState(0);
  const [playerMoves, setPlayerMoves] = useState([]);
  const [mazeSeed, setMazeSeed] = useState(null);
  const [solution, setSolution] = useState([]);
  const [playerData, setPlayerData] = useState({ attemptsUsed: 0, bestScore: 0 });
  const [lastScore, setLastScore] = useState(0);
  const [balance, setBalance] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [mazeTimeLeft, setMazeTimeLeft] = useState('');

  // Initialize game
  useEffect(() => {
    initializeGame();
  }, []);

  // Update maze timer
  useEffect(() => {
    const timer = setInterval(() => {
      updateMazeTimer();
    }, 1000);
    return () => clearInterval(timer);
  }, [mazeSeed]);

  async function initializeGame() {
    const seed = getCurrentMazeSeed();
    setMazeSeed(seed);
    setSolution(generateMazeSolution(seed));
    
    const data = await getPlayerData(seed);
    setPlayerData(data);
    
    const bal = await mockWorldSDK.getBalance();
    setBalance(bal);
    
    const lb = await getLeaderboard(seed);
    setLeaderboard(lb);
  }

  function updateMazeTimer() {
    const now = Date.now();
    const mazeStart = mazeSeed * CONFIG.MAZE_DURATION_HOURS * 60 * 60 * 1000;
    const mazeEnd = mazeStart + CONFIG.MAZE_DURATION_HOURS * 60 * 60 * 1000;
    const timeLeft = mazeEnd - now;
    
    if (timeLeft <= 0) {
      // Maze expired, reload
      initializeGame();
      return;
    }
    
    const hours = Math.floor(timeLeft / (60 * 60 * 1000));
    const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
    setMazeTimeLeft(`${hours}h ${minutes}m`);
  }

  async function startAttempt() {
    // Check balance
    if (balance < CONFIG.ATTEMPT_COST) {
      alert(`Insufficient balance. You need ${CONFIG.ATTEMPT_COST} WLD to play.`);
      return;
    }
    
    // Check attempts remaining
    if (playerData.attemptsUsed >= CONFIG.ATTEMPTS_PER_MAZE) {
      alert('No attempts remaining for this maze. Wait for the next maze.');
      return;
    }
    
    // Deduct funds
    const success = await mockWorldSDK.deductFunds(CONFIG.ATTEMPT_COST);
    if (!success) {
      alert('Payment failed. Please try again.');
      return;
    }
    
    setBalance(await mockWorldSDK.getBalance());
    setGameState('playing');
    setCurrentStep(0);
    setPlayerMoves([]);
    setFeedback('The corridor is shrouded in fog...');
  }

  function makeMove(direction) {
    const newMoves = [...playerMoves, direction];
    setPlayerMoves(newMoves);
    
    // Generate atmospheric feedback
    const feedbacks = [
      'You hear distant echoes...',
      'The air grows colder...',
      'Footsteps fade into darkness...',
      'A faint light flickers ahead...',
      'The walls seem to shift...',
      'Silence surrounds you...'
    ];
    setFeedback(feedbacks[Math.floor(Math.random() * feedbacks.length)]);
    
    if (newMoves.length >= CONFIG.STEPS_PER_ATTEMPT) {
      finishAttempt(newMoves);
    } else {
      setCurrentStep(newMoves.length);
    }
  }

  async function finishAttempt(moves) {
    const score = evaluateAttempt(moves, solution);
    setLastScore(score);
    
    // Update player data
    const newPlayerData = {
      attemptsUsed: playerData.attemptsUsed + 1,
      bestScore: Math.max(playerData.bestScore, score)
    };
    setPlayerData(newPlayerData);
    await savePlayerData(mazeSeed, newPlayerData);
    
    // Update leaderboard if new personal best
    if (score > playerData.bestScore) {
      const playerName = mockWorldSDK.getUserName();
      await updateLeaderboard(mazeSeed, playerName, score);
      const lb = await getLeaderboard(mazeSeed);
      setLeaderboard(lb);
    }
    
    setGameState('result');
  }

  function backToMenu() {
    setGameState('menu');
    setPlayerMoves([]);
    setCurrentStep(0);
  }

  // ============================================================================
  // UI RENDERING
  // ============================================================================

  const directionNames = ['Left', 'Forward', 'Right'];
  const attemptsRemaining = CONFIG.ATTEMPTS_PER_MAZE - playerData.attemptsUsed;

  if (gameState === 'menu') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-black text-white p-6">
        <div className="max-w-md mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Blind Maze
            </h1>
            <p className="text-gray-400 text-sm">Navigate the unseen path</p>
          </div>

          {/* Stats Card */}
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-purple-500/30">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-gray-400 text-xs mb-1">Your Best</p>
                <p className="text-2xl font-bold text-purple-400">{playerData.bestScore}%</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Attempts Left</p>
                <p className="text-2xl font-bold text-pink-400">{attemptsRemaining}</p>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Balance</span>
                <span className="font-semibold">{balance.toFixed(2)} WLD</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Cost per attempt</span>
                <span className="font-semibold text-yellow-400">{CONFIG.ATTEMPT_COST} WLD</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Maze resets in</span>
                <span className="font-semibold text-blue-400">{mazeTimeLeft}</span>
              </div>
            </div>
          </div>

          {/* How to Play */}
          <div className="bg-gray-800/50 rounded-lg p-4 mb-6 border border-gray-700">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              How to Play
            </h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>• Make {CONFIG.STEPS_PER_ATTEMPT} directional choices</li>
              <li>• Find the hidden path through the maze</li>
              <li>• Score is based on path accuracy</li>
              <li>• Each maze lasts {CONFIG.MAZE_DURATION_HOURS} hours</li>
              <li>• {CONFIG.ATTEMPTS_PER_MAZE} attempts per maze period</li>
            </ul>
          </div>

          {/* Start Button */}
          <button
            onClick={startAttempt}
            disabled={attemptsRemaining === 0 || balance < CONFIG.ATTEMPT_COST}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 py-4 rounded-lg font-bold text-lg mb-4 disabled:opacity-50 disabled:cursor-not-allowed hover:from-purple-500 hover:to-pink-500 transition-all"
          >
            {attemptsRemaining === 0 ? 'No Attempts Left' : 
             balance < CONFIG.ATTEMPT_COST ? 'Insufficient Balance' : 
             `Start Attempt (${CONFIG.ATTEMPT_COST} WLD)`}
          </button>

          {/* Leaderboard Toggle */}
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className="w-full bg-gray-700 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-gray-600 transition-all"
          >
            <Trophy className="w-5 h-5" />
            {showLeaderboard ? 'Hide Leaderboard' : 'View Leaderboard'}
          </button>

          {/* Leaderboard */}
          {showLeaderboard && (
            <div className="mt-4 bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="font-bold mb-3 text-center">Top Players</h3>
              {leaderboard.length === 0 ? (
                <p className="text-gray-500 text-sm text-center">No scores yet. Be the first!</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.slice(0, 10).map((player, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm py-2 border-b border-gray-700 last:border-0">
                      <span className="flex items-center gap-2">
                        <span className="text-gray-500 w-6">#{idx + 1}</span>
                        <span>{player.name}</span>
                      </span>
                      <span className="font-bold text-purple-400">{player.score}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (gameState === 'playing') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white p-6 flex items-center justify-center">
        <div className="max-w-md w-full">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Step {currentStep + 1} of {CONFIG.STEPS_PER_ATTEMPT}</span>
              <span className="text-purple-400 flex items-center gap-1">
                <Zap className="w-4 h-4" />
                {attemptsRemaining - 1} left
              </span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{ width: `${(currentStep / CONFIG.STEPS_PER_ATTEMPT) * 100}%` }}
              />
            </div>
          </div>

          {/* Feedback */}
          <div className="bg-gray-800/50 rounded-lg p-6 mb-8 text-center border border-gray-700 min-h-24 flex items-center justify-center">
            <p className="text-gray-300 italic">{feedback}</p>
          </div>

          {/* Direction Buttons */}
          <div className="space-y-4">
            {[0, 1, 2].map((dir) => (
              <button
                key={dir}
                onClick={() => makeMove(dir)}
                className="w-full bg-gradient-to-r from-gray-700 to-gray-600 py-6 rounded-lg font-bold text-xl hover:from-purple-600 hover:to-pink-600 transition-all transform hover:scale-105 active:scale-95"
              >
                {directionNames[dir]}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'result') {
    const isNewBest = lastScore > (playerData.bestScore - lastScore);
    const isPerfect = lastScore === 100;
    
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-black text-white p-6 flex items-center justify-center">
        <div className="max-w-md w-full text-center">
          {/* Result Display */}
          <div className="mb-8">
            {isPerfect && (
              <div className="text-6xl mb-4 animate-bounce">🎉</div>
            )}
            <h2 className="text-2xl font-bold mb-2">
              {isPerfect ? 'PERFECT!' : isNewBest ? 'New Personal Best!' : 'Attempt Complete'}
            </h2>
            <div className="text-7xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-4">
              {lastScore}%
            </div>
            <p className="text-gray-400">
              {isPerfect ? 'You found the perfect path!' :
               lastScore >= 90 ? 'So close! You nearly had it.' :
               lastScore >= 70 ? 'Good progress. You\'re getting warmer.' :
               lastScore >= 50 ? 'You\'re on the right track.' :
               'Keep exploring. Each attempt teaches you something.'}
            </p>
          </div>

          {/* Stats */}
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-purple-500/30">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-xs mb-1">Your Best</p>
                <p className="text-2xl font-bold text-purple-400">{playerData.bestScore}%</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Attempts Left</p>
                <p className="text-2xl font-bold text-pink-400">{attemptsRemaining}</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={backToMenu}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 py-4 rounded-lg font-bold text-lg hover:from-purple-500 hover:to-pink-500 transition-all"
          >
            Back to Menu
          </button>
        </div>
      </div>
    );
  }

  return null;
}

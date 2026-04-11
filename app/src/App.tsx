import { useTimerStore } from './store/timerStore';
import Navigation from './components/Navigation';
import StopwatchScreen from './components/StopwatchScreen';
import CustomTimerScreen from './components/CustomTimerScreen';
import PresetTimerScreen from './components/PresetTimerScreen';
import WorkoutRuntime from './components/WorkoutRuntime';
import WorkoutComplete from './components/WorkoutComplete';
import TransitionOverlay from './components/TransitionOverlay';
import GraphChoiceOverlay from './components/GraphChoiceOverlay';
import PreWorkoutReadiness from './components/PreWorkoutReadiness';
import ProgramDashboard from './components/ProgramDashboard';

export default function App() {
  const mode = useTimerStore((s) => s.mode);
  const engineState = useTimerStore((s) => s.engineState);

  // During an active session (any mode), show the runtime screen
  const showRuntime =
    (engineState === 'ACTIVE' || engineState === 'PAUSED' || engineState === 'COUNTDOWN') &&
    mode !== 'stopwatch';

  // After session completes (non-stopwatch), show summary
  const showComplete = engineState === 'COMPLETE' && mode !== 'stopwatch';

  function renderScreen() {
    if (showComplete) return <WorkoutComplete />;
    if (showRuntime) return <WorkoutRuntime />;

    switch (mode) {
      case 'program':
        return <ProgramDashboard />;
      case 'preset':
        return <PresetTimerScreen />;
      case 'custom':
        return <CustomTimerScreen />;
      case 'stopwatch':
      default:
        return <StopwatchScreen />;
    }
  }

  return (
    <>
      {/* Navigation is always visible unless deep in a session */}
      {!showRuntime && !showComplete && <Navigation />}

      {/* Screen */}
      {renderScreen()}

      {/* Overlays — stacking order: Transition (z-40) → Readiness (z-50) → Choice (z-50) */}
      <TransitionOverlay />
      <PreWorkoutReadiness />
      <GraphChoiceOverlay />
    </>
  );
}

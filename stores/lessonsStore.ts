import { create } from 'zustand';
import { ViewState, ActivityType } from '../types';

interface LessonsState {
  // Day selection
  selectedDayId: number;
  setSelectedDayId: (dayId: number) => void;
  
  // Lesson completion
  dayCompletedStatus: Record<number, boolean>;
  setDayCompletedStatus: (status: Record<number, boolean>) => void;
  updateDayCompleted: (day: number, completed: boolean) => void;
  
  // Lesson state
  lessonCompleted: boolean;
  setLessonCompleted: (completed: boolean) => void;
  
  // View state
  view: ViewState;
  setView: (view: ViewState) => void;
  
  // Activity state
  activityStep: ActivityType;
  setActivityStep: (step: ActivityType) => void;
  completedTasks: ActivityType[];
  setCompletedTasks: (tasks: ActivityType[]) => void;
  addCompletedTask: (task: ActivityType) => void;
  
  // Level
  level: string;
  setLevel: (level: string) => void;
  
  // Reset
  reset: () => void;
}

const initialState = {
  selectedDayId: 1,
  dayCompletedStatus: {} as Record<number, boolean>,
  lessonCompleted: false,
  view: ViewState.DASHBOARD,
  activityStep: ActivityType.DIALOGUE,
  completedTasks: [] as ActivityType[],
  level: 'A1',
};

// Note: We don't use persist middleware here because we need user-specific and level-specific keys
// The persistence is handled in AppContent.tsx with getCacheKeyWithCurrentUser
export const useLessonsStore = create<LessonsState>((set) => ({
  ...initialState,
  setSelectedDayId: (dayId) => set({ selectedDayId: dayId }),
  setDayCompletedStatus: (status) => set({ dayCompletedStatus: status }),
  updateDayCompleted: (day, completed) =>
    set((state) => ({
      dayCompletedStatus: { ...state.dayCompletedStatus, [day]: completed },
    })),
  setLessonCompleted: (completed) => set({ lessonCompleted: completed }),
  setView: (view) => set({ view }),
  setActivityStep: (step) => set({ activityStep: step }),
  setCompletedTasks: (tasks) => set({ completedTasks: tasks }),
  addCompletedTask: (task) =>
    set((state) => {
      if (state.completedTasks.includes(task)) return state;
      return { completedTasks: [...state.completedTasks, task] };
    }),
  setLevel: (level) => set({ level }),
  reset: () => set(initialState),
}));


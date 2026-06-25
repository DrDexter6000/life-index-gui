import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface JournalMetadata {
  title: string;
  date: string;
  topics: string[];
  moods: string[];
  people: string[];
  location: string;
  weather: string;
  project: string;
  abstract?: string;
  tags?: string[];
  links?: string[];
}

interface JournalDraftState {
  content: string;
  metadata: JournalMetadata;
  isDirty: boolean;
  lastSaved: Date | null;
}

interface JournalDraftActions {
  setContent: (content: string) => void;
  updateMetadata: (metadata: Partial<JournalMetadata>) => void;
  addTopic: (topic: string) => void;
  removeTopic: (topic: string) => void;
  addMood: (mood: string) => void;
  removeMood: (mood: string) => void;
  addPerson: (person: string) => void;
  removePerson: (person: string) => void;
  setLocation: (location: string) => void;
  setWeather: (weather: string) => void;
  setProject: (project: string) => void;
  markAsSaved: () => void;
  reset: () => void;
}

const defaultMetadata: JournalMetadata = {
  title: '',
  date: new Date().toISOString().split('T')[0],
  topics: [],
  moods: [],
  people: [],
  location: '',
  weather: '',
  project: '',
  abstract: '',
  tags: [],
  links: [],
};

export const useJournalDraftStore = create<JournalDraftState & JournalDraftActions>()(
  immer((set) => ({
    content: '',
    metadata: { ...defaultMetadata },
    isDirty: false,
    lastSaved: null,

    setContent: (content) =>
      set((state) => {
        state.content = content;
        state.isDirty = true;
      }),

    updateMetadata: (metadata) =>
      set((state) => {
        Object.assign(state.metadata, metadata);
        state.isDirty = true;
      }),

    addTopic: (topic) =>
      set((state) => {
        if (!state.metadata.topics.includes(topic)) {
          state.metadata.topics.push(topic);
          state.isDirty = true;
        }
      }),

    removeTopic: (topic) =>
      set((state) => {
        state.metadata.topics = state.metadata.topics.filter((t) => t !== topic);
        state.isDirty = true;
      }),

    addMood: (mood) =>
      set((state) => {
        if (!state.metadata.moods.includes(mood)) {
          state.metadata.moods.push(mood);
          state.isDirty = true;
        }
      }),

    removeMood: (mood) =>
      set((state) => {
        state.metadata.moods = state.metadata.moods.filter((m) => m !== mood);
        state.isDirty = true;
      }),

    addPerson: (person) =>
      set((state) => {
        if (!state.metadata.people.includes(person)) {
          state.metadata.people.push(person);
          state.isDirty = true;
        }
      }),

    removePerson: (person) =>
      set((state) => {
        state.metadata.people = state.metadata.people.filter((p) => p !== person);
        state.isDirty = true;
      }),

    setLocation: (location) =>
      set((state) => {
        state.metadata.location = location;
        state.isDirty = true;
      }),

    setWeather: (weather) =>
      set((state) => {
        state.metadata.weather = weather;
        state.isDirty = true;
      }),

    setProject: (project) =>
      set((state) => {
        state.metadata.project = project;
        state.isDirty = true;
      }),

    markAsSaved: () =>
      set((state) => {
        state.isDirty = false;
        state.lastSaved = new Date();
      }),

    reset: () =>
      set((state) => {
        state.content = '';
        state.metadata = { ...defaultMetadata };
        state.isDirty = false;
        state.lastSaved = null;
      }),
  }))
);

import { useState, useEffect } from 'react';
import { ActivityType, DayPlan, VocabResponse, GrammarResponse, CorrectionResponse } from '../types';
import { generateVocabulary, generateGrammar, generateCorrections } from '../services/generationService';

export const useContentGeneration = (currentDayPlan: DayPlan | undefined, selectedDayId: number) => {
  const [vocabData, setVocabData] = useState<VocabResponse | null>(null);
  const [grammarData, setGrammarData] = useState<GrammarResponse | null>(null);
  const [correctionData, setCorrectionData] = useState<CorrectionResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset content when day changes
  useEffect(() => {
    setVocabData(null);
    setGrammarData(null);
    setCorrectionData(null);
  }, [selectedDayId]);

  const generateContent = async (type: ActivityType) => {
    if (!currentDayPlan) return;

    setLoading(true);
    try {
      if (type === ActivityType.WARMUP && !vocabData) {
        const data = await generateVocabulary(
          currentDayPlan.theme,
          currentDayPlan.lesson || currentDayPlan.day,
          currentDayPlan.grammarFocus,
          undefined,
          currentDayPlan.wordIds
        );
        setVocabData(data);
      } else if (type === ActivityType.GRAMMAR && !grammarData) {
        const grammarRows = currentDayPlan.grammarRows || [];
        if (grammarRows.length === 0) {
          // Fallback: если нет grammarRows, используем старый метод
          const data = await generateGrammar([{
            level: "A1",
            order: 1,
            topic: currentDayPlan.grammarFocus.split(" — ")[0] || currentDayPlan.grammarFocus,
            subtopic: currentDayPlan.grammarFocus.includes(" — ") 
              ? currentDayPlan.grammarFocus.split(" — ")[1]?.split(";")[0] || ""
              : "",
            exponents_examples: "",
          }]);
          setGrammarData(data);
        } else {
          const data = await generateGrammar(grammarRows);
          setGrammarData(data);
        }
      } else if (type === ActivityType.CORRECTION && !correctionData) {
        const data = await generateCorrections(currentDayPlan.grammarFocus, currentDayPlan.theme);
        setCorrectionData(data);
      } else if (type === ActivityType.DIALOGUE) {
        if (!vocabData) {
          const data = await generateVocabulary(
            currentDayPlan.theme,
            currentDayPlan.lesson || currentDayPlan.day,
            currentDayPlan.grammarFocus,
            undefined,
            currentDayPlan.wordIds
          );
          setVocabData(data);
        }
      }
    } catch (e) {
      console.error("Error loading task", e);
    } finally {
      setLoading(false);
    }
  };

  return {
    vocabData,
    grammarData,
    correctionData,
    loading,
    generateContent,
    setVocabData,
    setGrammarData,
    setCorrectionData,
  };
};


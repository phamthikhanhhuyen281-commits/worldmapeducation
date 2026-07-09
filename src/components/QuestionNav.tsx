import React, { useState, useEffect } from 'react';
import { languageService, Language } from '../services/languageService';

interface QuestionNavProps {
  questions: { id: string; label: string }[];
  currentQuestionId: string;
  onQuestionSelect: (id: string) => void;
  answers: Record<string, string>;
  skippedQuestions: Record<string, boolean>;
}

export default function QuestionNav({
  questions,
  currentQuestionId,
  onQuestionSelect,
  answers,
  skippedQuestions
}: QuestionNavProps) {
  const [lang, setLang] = useState<Language>(languageService.getLanguage());

  useEffect(() => {
    return languageService.onChange((newLang) => {
      setLang(newLang);
    });
  }, []);

  const getStatusColorClass = (id: string) => {
    const isAnswered = !!answers[id] && answers[id].trim() !== '';
    const isSkipped = !!skippedQuestions[id];

    if (isAnswered) {
      return 'bg-green-500 text-white border-transparent';
    }
    if (isSkipped) {
      return 'bg-amber-100 text-amber-700 border-amber-200';
    }
    return 'bg-slate-100 text-slate-400 border-transparent hover:bg-slate-200';
  };

  return (
    <div id="question-navigator-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          {lang === 'vi' ? 'Bảng điều hướng' : 'Question Navigator'}
        </h3>
        <span className="text-xs font-mono text-slate-500 bg-slate-50 px-2.5 py-0.5 rounded-md border border-slate-200 font-semibold">
          {lang === 'vi' 
            ? `Đã làm: ${Object.keys(answers).length} / ${questions.length}` 
            : `${Object.keys(answers).length} / ${questions.length} Done`}
        </span>
      </div>

      {/* Grid of Question Numbers */}
      <div className="grid grid-cols-5 gap-2 max-h-[300px] overflow-y-auto pr-1 flex-grow scrollbar-thin">
        {questions.map((q, idx) => {
          const isActive = q.id === currentQuestionId;
          const statusClass = getStatusColorClass(q.id);

          return (
            <button
              key={q.id}
              id={`nav-q-${q.id}`}
              onClick={() => onQuestionSelect(q.id)}
              className={`w-full aspect-square flex items-center justify-center text-xs font-bold rounded-lg border transition-all cursor-pointer ${statusClass} ${
                isActive ? 'ring-2 ring-indigo-900 ring-offset-2 scale-105 border-indigo-900 font-extrabold' : ''
              }`}
            >
              {(idx + 1).toString().padStart(2, '0')}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-6 space-y-2 border-t border-slate-100 pt-4 text-xs font-medium text-slate-600">
        <div className="flex items-center">
          <div className="w-3.5 h-3.5 rounded bg-green-500 mr-2 shrink-0"></div>
          <span>
            {lang === 'vi' ? `Hoàn thành (${Object.keys(answers).length})` : `Completed (${Object.keys(answers).length})`}
          </span>
        </div>
        <div className="flex items-center">
          <div className="w-3.5 h-3.5 rounded bg-amber-100 border border-amber-200 mr-2 shrink-0"></div>
          <span>{lang === 'vi' ? 'Đã bỏ qua' : 'Skipped'}</span>
        </div>
        <div className="flex items-center">
          <div className="w-3.5 h-3.5 rounded bg-slate-100 mr-2 shrink-0"></div>
          <span>{lang === 'vi' ? 'Chưa bắt đầu' : 'Not Started'}</span>
        </div>
      </div>
    </div>
  );
}

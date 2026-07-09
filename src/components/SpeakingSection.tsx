import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Check, RefreshCw, AlertCircle, Play, Sparkles, Volume2 } from 'lucide-react';
import { SPEAKING_READ_ALOUD, SPEAKING_QUESTIONS } from '../questions';
import { candidateService } from '../services/candidateService';
import { storageService } from '../services/storageService';
import { speakingService } from '../services/speakingService';
import { languageService, Language } from '../services/languageService';

interface SpeakingSectionProps {
  candidateId: string;
  answers: Record<string, string>; // to see if speaking recordings already exist
  onAnswerChange: (questionId: string, value: string) => void;
  onRefreshSession: () => void;
  speakingQuestions?: any[];
  speakingReadAloud?: { text: string; wordCount: number };
}

export default function SpeakingSection({
  candidateId,
  answers,
  onAnswerChange,
  onRefreshSession,
  speakingQuestions = SPEAKING_QUESTIONS,
  speakingReadAloud = SPEAKING_READ_ALOUD
}: SpeakingSectionProps) {
  const [lang, setLang] = useState<Language>(languageService.getLanguage());

  useEffect(() => {
    return languageService.onChange((newLang) => {
      setLang(newLang);
    });
  }, []);

  const [permission, setPermission] = useState<boolean | null>(null);
  const [recordingState, setRecordingState] = useState<Record<string, 'idle' | 'recording' | 'saving' | 'done'>>({});
  const [recordingSeconds, setRecordingSeconds] = useState<Record<string, number>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});

  const mediaRecorders = useRef<Record<string, MediaRecorder>>({});
  const audioChunks = useRef<Record<string, Blob[]>>({});
  const timers = useRef<Record<string, NodeJS.Timeout>>({});

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(clearInterval);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Request mic permission
  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermission(true);
      // Clean up stream immediately
      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.error('Microphone permission rejected:', err);
      setPermission(false);
    }
  };

  useEffect(() => {
    requestPermission();
  }, []);

  const startRecording = async (id: string) => {
    // If already done, block recording entirely
    if (answers[id] || recordingState[id] === 'done') {
      alert('Bạn chỉ được phép ghi âm một lần duy nhất và không thể ghi đè.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let options: any = { audioBitsPerSecond: 24000 };
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          options.mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          options.mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          options.mimeType = 'audio/ogg';
        } else if (MediaRecorder.isTypeSupported('audio/wav')) {
          options.mimeType = 'audio/wav';
        }
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorders.current[id] = mediaRecorder;
      audioChunks.current[id] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current[id].push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setRecordingState(prev => ({ ...prev, [id]: 'saving' }));
        
        const actualMimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunks.current[id], { type: actualMimeType });
        const localUrl = URL.createObjectURL(audioBlob);
        setAudioUrls(prev => ({ ...prev, [id]: localUrl }));

        // Convert to Base64 to upload
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          try {
            // Upload audio directly to Firebase Storage
            const downloadUrl = await storageService.uploadBase64Audio(base64Audio, candidateId, id);
            
            // Map the audio path to the proper sub-field of answers
            let answersUpdate: any = {};
            if (id === 'speaking_p1') {
              answersUpdate.speakingPart1 = { audioPath: downloadUrl };
            } else if (id === 'speaking_p2_q1') {
              answersUpdate.speakingPart2 = { sp_1_audioPath: downloadUrl };
            } else if (id === 'speaking_p2_q2') {
              answersUpdate.speakingPart2 = { sp_2_audioPath: downloadUrl };
            } else if (id === 'speaking_p2_q3') {
              answersUpdate.speakingPart2 = { sp_3_audioPath: downloadUrl };
            }

            // Update candidate document in Firestore
            await candidateService.updateAnswers(candidateId, answersUpdate);
            
            // Mark answer as registered (save path as answer value in UI for tracking)
            onAnswerChange(id, downloadUrl);

            // If speaking_p1 (Read Aloud), trigger Gemini AI Pronunciation scoring automatically!
            if (id === 'speaking_p1') {
              speakingService.evaluateSpeakingAudio(downloadUrl, speakingReadAloud.text)
                .then(async (evaluation) => {
                  const answersUpdateWithEvaluation = {
                    speakingPart1: {
                      audioPath: downloadUrl,
                      aiEvaluation: evaluation
                    }
                  };
                  await candidateService.updateAnswers(candidateId, answersUpdateWithEvaluation);
                  onRefreshSession(); // update state in parent
                })
                .catch(err => console.error('Gemini background evaluate failed:', err));
            }

            setRecordingState(prev => ({ ...prev, [id]: 'done' }));
          } catch (err) {
            console.error('Audio upload failure:', err);
            setRecordingState(prev => ({ ...prev, [id]: 'idle' }));
            alert('Lỗi tải file ghi âm lên Firebase Storage. Vui lòng thử lại hoặc nhờ giáo viên hỗ trợ.');
          }
        };

        // Stop all audio tracks to release the microphone hardware
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setRecordingState(prev => ({ ...prev, [id]: 'recording' }));
      setRecordingSeconds(prev => ({ ...prev, [id]: 0 }));

      // Start timer
      timers.current[id] = setInterval(() => {
        setRecordingSeconds(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
      }, 1000);

    } catch (err) {
      console.error('Failed to start media recording:', err);
      alert('Không thể kết nối mic. Vui lòng cấp quyền micro cho trang web này trong trình duyệt.');
    }
  };

  const stopRecording = (id: string) => {
    const mediaRecorder = mediaRecorders.current[id];
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      if (timers.current[id]) {
        clearInterval(timers.current[id]);
      }
    }
  };

  const formatSeconds = (totalSeconds: number) => {
    if (!totalSeconds) return '00:00';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Check if recordings already exist in answers on mount/update
  useEffect(() => {
    const newStates = { ...recordingState };
    const newUrls = { ...audioUrls };

    if (answers['speaking_p1']) {
      newStates['speaking_p1'] = 'done';
      newUrls['speaking_p1'] = answers['speaking_p1'];
    }
    speakingQuestions.forEach((_, idx) => {
      const id = `speaking_p2_q${idx + 1}`;
      if (answers[id]) {
        newStates[id] = 'done';
        newUrls[id] = answers[id];
      }
    });

    setRecordingState(newStates);
    setAudioUrls(newUrls);
  }, [answers]);

  // AI Voice speech synthesizer for Part 2 Questions - Stuck-free Chrome fix
  const handleAISpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any currently playing audio
      
      // Delay-release ensure voice engine does not block
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.85; // Natural speed
        
        // Select an English voice if available
        const voices = window.speechSynthesis.getVoices();
        const enVoice = voices.find(v => v.lang.startsWith('en-') || v.lang.startsWith('en_'));
        if (enVoice) {
          utterance.voice = enVoice;
        }
        
        window.speechSynthesis.speak(utterance);
      }, 80);
    } else {
      alert('Trình duyệt của bạn không hỗ trợ tính năng AI đọc câu hỏi.');
    }
  };

  return (
    <div id="speaking-section-wrapper" className="space-y-8">
      
      {/* Mic Authorization Check */}
      {permission === false && (
        <div className="bg-red-50 border-l-4 border-red-600 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm font-medium text-red-800">
            {lang === 'vi' ? (
              <>
                <strong>LỖI: Trình duyệt chưa cấp quyền truy cập Micro.</strong> Vui lòng nhấn vào biểu tượng ổ khóa 🔒 trên thanh địa chỉ của trình duyệt và cho phép (Allow) Microphone để làm bài thi Nói.
              </>
            ) : (
              <>
                <strong>ERROR: Browser has not granted Microphone access.</strong> Please click the lock icon 🔒 in the browser address bar and choose "Allow" for the Microphone to take the Speaking exam.
              </>
            )}
          </p>
        </div>
      )}

      {/* PART 1: READ ALOUD */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-900" />
            <h3 className="font-extrabold text-[#1e3a8a] text-base uppercase">
              {lang === 'vi' ? 'SPEAKING BÀI 1: ĐỌC THÀNH TIẾNG ĐOẠN VĂN (B1)' : 'SPEAKING PART 1: READ ALOUD (B1)'}
            </h3>
          </div>
          <span className="text-xs font-mono font-bold bg-indigo-50 text-indigo-900 px-2.5 py-1 rounded-md">
            {lang === 'vi' ? 'Chỉ được ghi âm 1 lần' : 'One recording only'}
          </span>
        </div>

        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide">
          {lang === 'vi' ? (
            <>
              Đọc to và rõ ràng đoạn văn dưới đây vào microphone. Bạn chỉ có thể ghi âm <strong className="text-red-600 underline">1 lần duy nhất</strong> và không được sửa đổi hay ghi lại:
            </>
          ) : (
            <>
              Read the text aloud clearly and audibly into the microphone. You can only record <strong className="text-red-600 underline">ONCE</strong> and cannot edit or re-record:
            </>
          )}
        </p>

        {/* Reading Text Container */}
        <div className="bg-slate-50 border border-slate-150 p-6 md:p-8 rounded-2xl font-serif text-base md:text-lg leading-relaxed text-slate-800 select-none shadow-inner text-justify">
          "{speakingReadAloud.text}"
        </div>

        {/* Recording Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-3">
            {recordingState['speaking_p1'] === 'recording' ? (
              <button
                onClick={() => stopRecording('speaking_p1')}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" /> {lang === 'vi' ? 'Stop (Dừng & Lưu)' : 'Stop (Stop & Save)'}
              </button>
            ) : (
              <button
                onClick={() => startRecording('speaking_p1')}
                disabled={recordingState['speaking_p1'] === 'saving' || recordingState['speaking_p1'] === 'done'}
                className="bg-indigo-900 hover:bg-indigo-850 text-white font-bold py-3 px-6 rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                <Mic className="w-4 h-4" /> 
                {recordingState['speaking_p1'] === 'done' 
                  ? (lang === 'vi' ? 'Locked (Đã khóa ghi âm)' : 'Locked (Recorded)') 
                  : (lang === 'vi' ? 'Start Recording (Bắt đầu nói)' : 'Start Recording')}
              </button>
            )}

            {/* Timer or Status indicators */}
            {recordingState['speaking_p1'] === 'recording' && (
              <div className="flex items-center gap-2 text-red-600 font-mono font-bold animate-pulse">
                <span className="w-2.5 h-2.5 bg-red-600 rounded-full inline-block animate-ping" />
                <span>{formatSeconds(recordingSeconds['speaking_p1'] || 0)}</span>
              </div>
            )}

            {recordingState['speaking_p1'] === 'saving' && (
              <div className="flex items-center gap-2 text-indigo-900 font-semibold animate-bounce text-sm">
                <RefreshCw className="w-4 h-4 animate-spin" /> {lang === 'vi' ? 'Đang lưu ghi âm bài nói...' : 'Saving voice recording...'}
              </div>
            )}

            {recordingState['speaking_p1'] === 'done' && (
              <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-xl text-xs font-extrabold">
                <Check className="w-4 h-4" /> {lang === 'vi' ? 'Đã ghi nhận & Khóa bài nói (Không được ghi âm lại)' : 'Voice recorded & locked (Cannot re-record)'}
              </div>
            )}
          </div>

          {/* Reassurance text */}
          {recordingState['speaking_p1'] === 'done' && (
            <div className="text-xs text-slate-400 flex items-center gap-2 font-medium">
              <span className="font-sans italic">
                {lang === 'vi' ? 'Hệ thống AI đang chấm điểm phát âm của bạn.' : 'AI pronunciation evaluation is in progress.'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* PART 2: INTERVIEW QUESTIONS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-indigo-900" />
            <h3 className="font-extrabold text-[#1e3a8a] text-base uppercase">
              {lang === 'vi' ? 'SPEAKING BÀI 2: TRẢ LỜI CÂU HỎI PHỎNG VẤN (B2)' : 'SPEAKING PART 2: INTERVIEW QUESTIONS (B2)'}
            </h3>
          </div>
          <span className="text-xs font-mono font-bold bg-amber-50 text-amber-850 px-2.5 py-1 rounded-md">
            {lang === 'vi' ? 'Nghe câu hỏi + Ghi âm 1 lần duy nhất' : 'Listen + One recording only'}
          </span>
        </div>

        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide">
          {lang === 'vi' 
            ? 'Bấm nút AI để nghe câu hỏi đọc to. Sau đó bấm nút Ghi âm để trả lời câu hỏi (Chỉ được ghi âm 1 lần duy nhất):'
            : 'Click the AI button to hear the question. Then click Record to answer (Only one recording allowed):'}
        </p>

        {/* Questions Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {speakingQuestions.map((q, idx) => {
            const id = `speaking_p2_q${idx + 1}`;
            const state = recordingState[id] || 'idle';
            const seconds = recordingSeconds[id] || 0;
            const isCompleted = state === 'done';

            return (
              <div key={q.id} className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <span className="text-xs font-extrabold text-indigo-900 tracking-wider block">
                    {lang === 'vi' ? `CÂU HỎI ${idx + 1}` : `QUESTION ${idx + 1}`}
                  </span>
                  
                  {/* AI Read Question Aloud Button */}
                  <button
                    onClick={() => handleAISpeak(q.text)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-950 font-bold rounded-xl text-xs border border-indigo-200 transition-all select-none cursor-pointer"
                    title={lang === 'vi' ? 'Nhấp vào đây để AI đọc to câu hỏi này' : 'Click here to have AI read this question aloud'}
                  >
                    <Volume2 className="w-4 h-4 text-indigo-900 animate-pulse" />
                    <span>{lang === 'vi' ? 'Nhấp vào đây để nghe câu hỏi' : 'Click here to listen'}</span>
                  </button>

                  <p className="text-sm font-extrabold text-slate-800 leading-relaxed font-sans italic pt-1 text-center">
                    "{q.text}"
                  </p>
                </div>

                {/* Recorder Control inside card */}
                <div className="pt-2 flex flex-col gap-2">
                  <div className="flex items-center justify-center gap-2">
                    {state === 'recording' ? (
                      <button
                        onClick={() => stopRecording(id)}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" /> {lang === 'vi' ? 'Stop (Dừng & Lưu)' : 'Stop (Stop & Save)'}
                      </button>
                    ) : (
                      <button
                        onClick={() => startRecording(id)}
                        disabled={state === 'saving' || isCompleted}
                        className="w-full bg-indigo-900 hover:bg-indigo-850 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                      >
                        <Mic className="w-3.5 h-3.5" /> 
                        {isCompleted 
                          ? (lang === 'vi' ? 'Locked (Đã khóa)' : 'Locked') 
                          : (lang === 'vi' ? 'Ghi âm' : 'Record')}
                      </button>
                    )}
                  </div>

                  {state === 'recording' && (
                    <div className="flex items-center justify-center gap-1.5 text-red-600 font-mono font-black text-xs animate-pulse">
                      <span className="w-2 h-2 bg-red-600 rounded-full inline-block animate-ping" />
                      <span>{formatSeconds(seconds)}</span>
                    </div>
                  )}

                  {state === 'saving' && (
                    <span className="text-indigo-900 font-extrabold text-xs flex items-center justify-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {lang === 'vi' ? 'Đang lưu file âm thanh...' : 'Saving audio file...'}
                    </span>
                  )}

                  {isCompleted && (
                    <span className="flex items-center justify-center gap-1 bg-green-50 border border-green-200 text-green-700 py-1.5 rounded-lg text-xs font-black">
                      <Check className="w-3.5 h-3.5" /> {lang === 'vi' ? 'Đã lưu ✓ (Không thể ghi lại)' : 'Saved ✓ (Locked)'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

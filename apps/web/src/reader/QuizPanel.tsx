import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { QuizDto, QuizResultDto, QuizTask } from '@bookverse/shared';
import { api, ApiError } from '../lib/api.ts';
import { showGameEvent, toast } from '../stores/toasts.ts';
import { IconCheck, IconClose } from '../ui/Icons.tsx';

type Answer = number | number[] | undefined;

function SingleTask({ task, value, onChange }: { task: Extract<QuizTask, { type: 'single' }>; value: Answer; onChange: (v: number) => void }) {
  return (
    <div className="quiz-options">
      {task.options.map((option, index) => (
        <button key={option} type="button" className="quiz-option" aria-pressed={value === index} onClick={() => onChange(index)}>
          {option}
        </button>
      ))}
    </div>
  );
}

/** Порядок событий: карточки переставляются кнопками, это работает и с клавиатуры, и на телефоне. */
function OrderTask({ task, value, onChange }: { task: Extract<QuizTask, { type: 'order' }>; value: Answer; onChange: (v: number[]) => void }) {
  const order = Array.isArray(value) ? value : task.items.map((_, i) => i);
  const move = (from: number, to: number) => {
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <ol className="quiz-order">
      {order.map((itemIndex, position) => (
        <li key={itemIndex}>
          <span className="quiz-order-num">{position + 1}</span>
          <span className="quiz-order-text">{task.items[itemIndex]}</span>
          <button type="button" className="icon-btn" onClick={() => move(position, position - 1)} disabled={position === 0} aria-label="Выше">↑</button>
          <button type="button" className="icon-btn" onClick={() => move(position, position + 1)} disabled={position === order.length - 1} aria-label="Ниже">↓</button>
        </li>
      ))}
    </ol>
  );
}

function MatchTask({ task, value, onChange }: { task: Extract<QuizTask, { type: 'match' }>; value: Answer; onChange: (v: number[]) => void }) {
  const chosen = Array.isArray(value) ? value : task.left.map(() => -1);
  return (
    <div className="quiz-match">
      {task.left.map((left, index) => (
        <label key={left}>
          <span>{left}</span>
          <select
            className="select"
            value={chosen[index]}
            onChange={(event) => {
              const next = [...chosen];
              next[index] = Number(event.target.value);
              onChange(next);
            }}
          >
            <option value={-1}>Выберите…</option>
            {task.right.map((right, i) => <option key={right} value={i}>{right}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function Mission({ quiz }: { quiz: QuizDto }) {
  const client = useQueryClient();
  const [answers, setAnswers] = useState<Answer[]>(() => quiz.tasks.map(() => undefined));
  const [result, setResult] = useState<QuizResultDto | null>(null);
  const [sending, setSending] = useState(false);

  const setAnswer = (index: number, value: Answer) => setAnswers((list) => list.map((a, i) => (i === index ? value : a)));

  const submit = async () => {
    setSending(true);
    try {
      const payload = answers.map((a, i) => {
        const task = quiz.tasks[i]!;
        if (a !== undefined) return a;
        return task.type === 'order' ? task.items.map((_, n) => n) : task.type === 'match' ? task.left.map(() => -1) : -1;
      });
      const response = await api<QuizResultDto>(`/quizzes/${quiz.id}/submit`, { method: 'POST', body: { answers: payload } });
      setResult(response);
      showGameEvent(response.game);
      void client.invalidateQueries({ queryKey: ['profile'] });
    } catch (error) {
      toast('Не удалось отправить ответы', error instanceof ApiError ? error.message : undefined, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <h3 className="display quiz-title">{quiz.title}</h3>
      {quiz.tasks.map((task, index) => (
        <section key={task.prompt} className="quiz-task">
          <p className="quiz-prompt">{task.prompt}</p>
          {task.type === 'single' && <SingleTask task={task} value={answers[index]} onChange={(v) => setAnswer(index, v)} />}
          {task.type === 'order' && <OrderTask task={task} value={answers[index]} onChange={(v) => setAnswer(index, v)} />}
          {task.type === 'match' && <MatchTask task={task} value={answers[index]} onChange={(v) => setAnswer(index, v)} />}
          {result?.results[index] && (
            <div className={`quiz-feedback ${result.results[index].correct ? 'is-right' : ''}`}>
              <p className="quiz-verdict">
                {result.results[index].correct ? <><IconCheck width={15} height={15} /> Верно</> : 'Давайте разберёмся'}
              </p>
              {!result.results[index].correct && <p><b>Правильно:</b> {result.results[index].correctAnswer}</p>}
              <p>{result.results[index].explanation}</p>
            </div>
          )}
        </section>
      ))}
      {result ? (
        <div className="quiz-summary">
          <p className="display">{result.score} из {result.total}</p>
          <button type="button" className="btn btn-ghost" onClick={() => { setResult(null); setAnswers(quiz.tasks.map(() => undefined)); }}>Попробовать ещё раз</button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={sending}>Проверить ответы</button>
      )}
    </>
  );
}

export function QuizPanel({ publicId, chapterOrder, onClose }: { publicId: string; chapterOrder: number; onClose: () => void }) {
  const { data: quizzes, isLoading } = useQuery({
    queryKey: ['quizzes', publicId],
    queryFn: () => api<QuizDto[]>(`/books/${publicId}/quizzes`),
  });
  const quiz = quizzes?.find((q) => q.chapterOrder === chapterOrder) ?? quizzes?.[0];

  return (
    <motion.aside
      className="rd-sheet scroll-area"
      role="dialog"
      aria-label="Задание по книге"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.28, ease: [0.22, 0.72, 0.18, 1] }}
    >
      <div className="rd-sheet-head">
        <h2 className="display">Литературное задание</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><IconClose /></button>
      </div>
      {isLoading && <p className="rd-sheet-note">Готовим задание…</p>}
      {!isLoading && !quiz && <p className="rd-sheet-note">Заданий к этой книге пока нет. Мы добавляем только вопросы, проверенные вручную.</p>}
      {quiz && <Mission key={quiz.id} quiz={quiz} />}
    </motion.aside>
  );
}

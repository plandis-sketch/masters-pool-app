import { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import type { Message } from '../lib/types';

export default function MessageBoard() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'messages'), orderBy('createdAt', 'desc')),
      (snap) => {
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)));
        setLoading(false);
      },
      (err) => {
        console.error('[MessageBoard] snapshot error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  async function handlePost() {
    const content = text.trim();
    if (!content || !user) return;
    setPosting(true);
    try {
      const isAdminAnnouncement = user.isAdmin && isAnnouncement;
      await addDoc(collection(db, 'messages'), {
        authorId: user.uid,
        authorName: user.displayName,
        content,
        createdAt: serverTimestamp(),
        isAnnouncement: isAdminAnnouncement,
        emailSent: isAdminAnnouncement ? false : null,
      });
      setText('');
      setIsAnnouncement(false);
      textareaRef.current?.focus();
    } catch (err) {
      console.error('[MessageBoard] post error:', err);
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(messageId: string) {
    if (!user?.isAdmin) return;
    try {
      await deleteDoc(doc(db, 'messages', messageId));
    } catch (err) {
      console.error('[MessageBoard] delete error:', err);
    }
  }

  function formatDate(ts: Message['createdAt']) {
    if (!ts) return '';
    const date = ts.toDate();
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) + ' at ' + date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // Announcements always pinned to top, then rest in reverse chron order
  const announcements = messages.filter((m) => m.isAnnouncement);
  const regular = messages.filter((m) => !m.isAnnouncement);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Message Board</h1>

      {/* Post form */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost();
          }}
          placeholder="Write a message..."
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-masters-green"
        />
        <div className="flex items-center justify-between mt-2">
          {user?.isAdmin ? (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAnnouncement}
                onChange={(e) => setIsAnnouncement(e.target.checked)}
                className="accent-masters-green"
              />
              Post as Announcement
            </label>
          ) : (
            <span />
          )}
          <button
            onClick={handlePost}
            disabled={!text.trim() || posting}
            className="bg-masters-green text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-masters-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {posting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>

      {/* Messages */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : messages.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No messages yet. Be the first to post!
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pinned announcements */}
          {announcements.map((msg) => (
            <MessageCard
              key={msg.id}
              msg={msg}
              isAdmin={!!user?.isAdmin}
              onDelete={handleDelete}
              formatDate={formatDate}
            />
          ))}
          {/* Regular messages */}
          {regular.map((msg) => (
            <MessageCard
              key={msg.id}
              msg={msg}
              isAdmin={!!user?.isAdmin}
              onDelete={handleDelete}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageCard({
  msg,
  isAdmin,
  onDelete,
  formatDate,
}: {
  msg: Message;
  isAdmin: boolean;
  onDelete: (id: string) => void;
  formatDate: (ts: Message['createdAt']) => string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (msg.isAnnouncement) {
    return (
      <div className="bg-masters-yellow/20 border border-masters-yellow rounded-xl p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">{msg.authorName}</span>
            <span className="bg-masters-green text-white text-xs font-bold px-2 py-0.5 rounded-full">
              ADMIN
            </span>
            <span className="bg-masters-yellow text-masters-dark text-xs font-bold px-2 py-0.5 rounded-full">
              ANNOUNCEMENT
            </span>
            <span className="text-xs text-gray-500">{formatDate(msg.createdAt)}</span>
          </div>
          {isAdmin && (
            <DeleteButton
              confirmDelete={confirmDelete}
              onAskDelete={() => setConfirmDelete(true)}
              onConfirm={() => onDelete(msg.id)}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
        </div>
        <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-gray-900">{msg.authorName}</span>
          <span className="text-xs text-gray-400">{formatDate(msg.createdAt)}</span>
        </div>
        {isAdmin && (
          <DeleteButton
            confirmDelete={confirmDelete}
            onAskDelete={() => setConfirmDelete(true)}
            onConfirm={() => onDelete(msg.id)}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>
      <p className="mt-1.5 text-sm text-gray-800 whitespace-pre-wrap break-words">{msg.content}</p>
    </div>
  );
}

function DeleteButton({
  confirmDelete,
  onAskDelete,
  onConfirm,
  onCancel,
}: {
  confirmDelete: boolean;
  onAskDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (confirmDelete) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onConfirm}
          className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-0.5 rounded transition"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onAskDelete}
      className="text-gray-300 hover:text-red-400 transition shrink-0 text-xs"
      title="Delete message"
    >
      ✕
    </button>
  );
}

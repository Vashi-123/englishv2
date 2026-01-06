import React from 'react';

type AchievementCardProps = {
  isRevisit?: boolean;
};

export function AchievementCard({ isRevisit = false }: AchievementCardProps) {
  return (
    <div className="flex justify-center my-8 animate-fade-in">
      <div className="relative group">
        <div className="relative bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-3xl p-8 shadow-2xl border-2 border-amber-300/60 backdrop-blur-sm overflow-hidden achievement-card">
          <div className="absolute inset-0">
            <div className="absolute top-0 left-0 w-40 h-40 bg-gradient-to-br from-amber-400/60 to-orange-400/60 rounded-full blur-3xl animate-float-slow"></div>
            <div
              className="absolute bottom-0 right-0 w-48 h-48 bg-gradient-to-br from-rose-400/60 to-pink-400/60 rounded-full blur-3xl animate-float-slow"
              style={{ animationDelay: '1s' }}
            ></div>
            <div
              className="absolute top-1/2 left-1/2 w-36 h-36 bg-gradient-to-br from-yellow-400/50 to-amber-400/50 rounded-full blur-3xl animate-float-slow"
              style={{ animationDelay: '0.5s', transform: 'translate(-50%, -50%)' }}
            ></div>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 rounded-full blur-2xl opacity-80 animate-glow-pulse"></div>
              <div
                className="absolute inset-0 bg-gradient-to-r from-yellow-300 via-orange-300 to-pink-300 rounded-full blur-xl opacity-60 animate-glow-pulse"
                style={{ animationDelay: '0.3s' }}
              ></div>

              <div className="absolute inset-0 border-4 border-transparent border-t-amber-400 border-r-orange-400 border-b-rose-400 border-l-pink-400 rounded-full animate-spin-slow"></div>

              <div className="relative w-24 h-24 bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 rounded-full flex items-center justify-center shadow-2xl transform transition-all duration-300 group-hover:scale-110 achievement-icon">
                <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-full"></div>
                <svg
                  className="w-12 h-12 text-white relative z-10 drop-shadow-lg"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                  />
                </svg>
              </div>

              {[...Array(16)].map((_, i) => {
                const angle = (360 / 16) * i;
                const radians = (angle * Math.PI) / 180;
                const distance = 60 + (i % 3) * 10;
                const x = Math.cos(radians) * distance;
                const y = Math.sin(radians) * distance;
                const colors = ['#FBBF24', '#FB923C', '#F87171', '#F472B6', '#A78BFA'];
                const color = colors[i % colors.length];
                return (
                  <div
                    key={i}
                    className="absolute twinkle-particle"
                    style={{
                      left: `calc(50% + ${x}px)`,
                      top: `calc(50% + ${y}px)`,
                      marginLeft: '-6px',
                      marginTop: '-6px',
                      animationDelay: `${i * 0.1}s`,
                      animationDuration: `${1.5 + (i % 3) * 0.3}s`,
                      width: `${4 + (i % 2) * 2}px`,
                      height: `${4 + (i % 2) * 2}px`,
                      backgroundColor: color,
                      borderRadius: '50%',
                      boxShadow: `0 0 ${8 + i * 2}px ${color}, 0 0 ${16 + i * 2}px ${color}`,
                    }}
                  />
                );
              })}

              {[...Array(6)].map((_, i) => {
                const angle = (360 / 6) * i;
                const radians = (angle * Math.PI) / 180;
                const distance = 80;
                const endX = Math.cos(radians) * distance;
                const endY = Math.sin(radians) * distance;
                return (
                  <div
                    key={`fly-${i}`}
                    className="absolute flying-particle"
                    style={
                      {
                        left: '50%',
                        top: '50%',
                        marginLeft: '-3px',
                        marginTop: '-3px',
                        animationDelay: `${i * 0.4}s`,
                        '--end-x': `${endX}px`,
                        '--end-y': `${endY}px`,
                      } as React.CSSProperties
                    }
                  />
                );
              })}
            </div>

            <h3 className="text-2xl font-extrabold bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 bg-clip-text text-transparent mb-3 animate-text-shimmer">
              {isRevisit ? 'Урок завершен!' : 'Отличная работа!'}
            </h3>
            <p className="text-sm font-medium text-amber-700 text-center max-w-xs">
              {isRevisit ? 'Ты уже прошел этот урок ранее' : 'Продолжай в том же духе'}
            </p>
          </div>
        </div>

        <div className="absolute -top-3 -right-3 w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full opacity-80 animate-ping-large shadow-lg"></div>
        <div
          className="absolute -bottom-3 -left-3 w-6 h-6 bg-gradient-to-br from-rose-400 to-pink-500 rounded-full opacity-80 animate-ping-large shadow-lg"
          style={{ animationDelay: '0.5s' }}
        ></div>
        <div
          className="absolute top-1/2 -right-4 w-4 h-4 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-full opacity-70 animate-ping-large shadow-lg"
          style={{ animationDelay: '0.3s' }}
        ></div>
        <div
          className="absolute top-1/2 -left-4 w-5 h-5 bg-gradient-to-br from-orange-400 to-rose-500 rounded-full opacity-70 animate-ping-large shadow-lg"
          style={{ animationDelay: '0.7s' }}
        ></div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(0.6); }
          50% { opacity: 1; transform: scale(1.5); }
        }
        @keyframes float-slow {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.6; }
          50% { transform: translate(20px, -20px) scale(1.1); opacity: 0.8; }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes flying-particle {
          0% { transform: translate(0, 0) scale(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translate(var(--end-x, 0px), var(--end-y, 0px)) scale(1); opacity: 0; }
        }
        @keyframes text-shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes ping-large {
          0% { transform: scale(1); opacity: 0.8; }
          50%, 100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes fade-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }
        .twinkle-particle { animation: twinkle ease-in-out infinite; }
        .flying-particle {
          width: 6px;
          height: 6px;
          background: linear-gradient(135deg, #FBBF24, #FB923C);
          border-radius: 50%;
          box-shadow: 0 0 10px #FBBF24, 0 0 20px #FB923C;
          animation: flying-particle 3s ease-out infinite;
        }
        .animate-float-slow { animation: float-slow 6s ease-in-out infinite; }
        .animate-glow-pulse { animation: glow-pulse 2s ease-in-out infinite; }
        .animate-spin-slow { animation: spin-slow 8s linear infinite; }
        .animate-text-shimmer { background-size: 200% auto; animation: text-shimmer 3s linear infinite; }
        .animate-ping-large { animation: ping-large 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .achievement-card { transition: all 0.3s ease; }
        .achievement-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 25px 50px -12px rgba(251, 191, 36, 0.5);
        }
        .achievement-icon { filter: drop-shadow(0 0 20px rgba(251, 191, 36, 0.6)); }
      `}</style>
    </div>
  );
}

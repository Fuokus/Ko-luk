// Merkezi yapılandırma: ders listesi, net formülü, limitler.
module.exports = {
  subjects: ['Türkçe','Matematik','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe','Din Kültürü'],
  net: (c, w) => Math.round((c - w / 4) * 100) / 100,
  tzOffsetHours: 3,
  sessionDays: 14,
  maxMinutes: 1440,
  maxQuestions: 5000,
};

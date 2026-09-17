import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-flexflow-ui';
if (![process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.FIRESTORE_EMULATOR_HOST]
  .every((host) => /^(127\.0\.0\.1|localhost):\d+$/.test(host ?? ''))) {
  throw new Error('End-to-end seeding requires local Firebase emulators.');
}

const app = initializeApp({ projectId });
const users = [
  { uid: 'e2e-admin', email: 'e2e-admin@example.test', password: 'local-e2e-admin-password', role: 'admin' },
  { uid: 'e2e-reviewer', email: 'e2e-reviewer@example.test', password: 'local-e2e-reviewer-password', role: 'reviewer' },
  { uid: 'e2e-designer', email: 'e2e-designer@example.test', password: 'local-e2e-designer-password', role: 'designer' },
];

for (const user of users) {
  await getAuth(app).createUser({ uid: user.uid, email: user.email, password: user.password });
  await getFirestore(app).collection('studioUsers').doc(user.uid).set({
    email: user.email,
    role: user.role,
    active: true,
  });
}

await getFirestore(app).collection('studioProjects').doc('phase5-project').set({
  id: 'phase5-project',
  name: 'Phase 5 test project',
  packageName: 'com.example.phase5',
  memberIds: ['e2e-admin', 'e2e-reviewer'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  updatedBy: 'Local test fixture',
});

console.log('Seeded local FlexFlow UI emulator accounts.');

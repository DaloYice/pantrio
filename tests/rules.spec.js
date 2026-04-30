/**
 * Security-Rules Unit-Tests für die pantrio RTDB.
 *
 * Voraussetzungen lokal:
 *   - Node.js >= 18
 *   - Java 11+ (Firebase Emulator)
 *   - npm install
 *
 * Ausführen:
 *   npm test
 *
 * (Der `firebase emulators:exec`-Befehl in package.json startet die
 *  Database-Emulator-Instanz, lädt unsere Rules, lässt mocha laufen
 *  und beendet alles wieder sauber.)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

const RULES_PATH = path.join(__dirname, '..', 'database.rules.json');
const PROJECT_ID = 'pantrio-test';
const HOST = '127.0.0.1';
const PORT = 9000;

let testEnv;

before(async function () {
  this.timeout(15000);
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      host: HOST,
      port: PORT,
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

function authed(uid) {
  return testEnv.authenticatedContext(uid).database();
}
function anon() {
  return testEnv.unauthenticatedContext().database();
}
async function seed(callback) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await callback(ctx.database());
  });
}

describe('pantrio – RTDB Security Rules', () => {
  describe('/familyCodes', () => {
    it('blockt anonymes Lesen', async () => {
      await assertFails(anon().ref('familyCodes').once('value'));
    });

    it('blockt Enumeration durch authentifizierte User', async () => {
      await seed(async (db) => {
        await db.ref('familyCodes/ABC123').set('-fam1');
      });
      await assertFails(authed('alice').ref('familyCodes').once('value'));
    });

    it('erlaubt einzelnen Code-Lookup für authentifizierte User', async () => {
      await seed(async (db) => {
        await db.ref('familyCodes/ABC123').set('-fam1');
      });
      await assertSucceeds(authed('alice').ref('familyCodes/ABC123').once('value'));
    });

    it('blockt Schreiben durch Nicht-Admin', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/members/alice').set({ role: 'member' });
      });
      await assertFails(
        authed('alice').ref('familyCodes/NEW').set('-fam1')
      );
    });

    it('erlaubt Schreiben durch Admin der Zielfamilie', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/members/alice').set({ role: 'admin' });
      });
      await assertSucceeds(
        authed('alice').ref('familyCodes/NEW').set('-fam1')
      );
    });

    it('blockt Hijack: Admin von A kann Code für B nicht überschreiben', async () => {
      await seed(async (db) => {
        await db.ref('families/-famA/members/alice').set({ role: 'admin' });
        await db.ref('families/-famB/members/bob').set({ role: 'admin' });
        await db.ref('familyCodes/SECRET').set('-famB');
      });
      await assertFails(
        authed('alice').ref('familyCodes/SECRET').set('-famA')
      );
    });

    it('erlaubt Löschen alter Codes durch Admin der Zielfamilie (für Rotation)', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/members/alice').set({ role: 'admin' });
        await db.ref('familyCodes/OLD').set('-fam1');
      });
      await assertSucceeds(
        authed('alice').ref('familyCodes/OLD').remove()
      );
    });

    it('blockt Löschen durch Nicht-Admin', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/members/alice').set({ role: 'member' });
        await db.ref('familyCodes/CODE').set('-fam1');
      });
      await assertFails(
        authed('alice').ref('familyCodes/CODE').remove()
      );
    });
  });

  describe('/families', () => {
    it('blockt Lesen für Nicht-Member', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          members: { bob: { role: 'admin' } },
        });
      });
      await assertFails(authed('alice').ref('families/-fam1').once('value'));
    });

    it('erlaubt Lesen für Member', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          members: { alice: { role: 'member' } },
        });
      });
      await assertSucceeds(authed('alice').ref('families/-fam1').once('value'));
    });
  });

  describe('/families/$id/members/$uid – Self-Join', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          members: { bob: { role: 'admin' } },
        });
        await db.ref('familyCodes/VALIDCODE').set('-fam1');
      });
    });

    it('blockt Self-Join ohne joinCode-Feld', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/alice').set({ role: 'member' })
      );
    });

    it('blockt Self-Join mit fake joinCode', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/alice').set({
          role: 'member',
          joinCode: 'FAKECODE',
        })
      );
    });

    it('blockt Self-Join mit Code zu anderer Familie', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam2').set({
          name: 'Familie B',
          members: { eve: { role: 'admin' } },
        });
        await db.ref('familyCodes/B_CODE').set('-fam2');
      });
      await assertFails(
        authed('alice').ref('families/-fam1/members/alice').set({
          role: 'member',
          joinCode: 'B_CODE',
        })
      );
    });

    it('erlaubt Self-Join mit gültigem Code für genau diese Familie', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/members/alice').set({
          role: 'member',
          joinCode: 'VALIDCODE',
        })
      );
    });

    it('blockt Schreiben in fremden Member-Slot ohne Admin-Rechte', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/charlie').set({
          role: 'member',
          joinCode: 'VALIDCODE',
        })
      );
    });
  });

  describe('/users', () => {
    it('blockt Lesen fremder User-Profile', async () => {
      await seed(async (db) => {
        await db.ref('users/bob').set({ familyId: '-fam1' });
      });
      await assertFails(authed('alice').ref('users/bob').once('value'));
    });

    it('erlaubt Lesen eigenes Profil', async () => {
      await seed(async (db) => {
        await db.ref('users/alice').set({ familyId: '-fam1' });
      });
      await assertSucceeds(authed('alice').ref('users/alice').once('value'));
    });

    it('blockt Schreiben auf fremde User-Profile', async () => {
      await assertFails(authed('alice').ref('users/bob').set({ x: 1 }));
    });
  });

  describe('Anonymer Zugriff', () => {
    it('blockt anonyme Reads auf alle Top-Level-Knoten', async () => {
      await assertFails(anon().ref('/').once('value'));
      await assertFails(anon().ref('users').once('value'));
      await assertFails(anon().ref('families').once('value'));
      await assertFails(anon().ref('familyCodes').once('value'));
    });
  });
});

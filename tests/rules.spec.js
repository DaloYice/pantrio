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

  describe('Role-Escalation-Schutz', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    it('blockt Self-Promotion: Member kann nicht eigene Rolle auf admin setzen', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/alice/role').set('admin')
      );
    });

    it('blockt Self-Promotion via Member-Slot-Update', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/alice').update({ role: 'admin' })
      );
    });

    it('blockt Self-Promotion via Family-Tree-Update', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/alice').set({ role: 'admin', name: 'Alice' })
      );
    });

    it('erlaubt Admin, andere Members zu promoten', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/members/alice/role').set('admin')
      );
    });

    it('erlaubt Admin, sich selbst zu degradieren', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/members/bob/role').set('member')
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

  describe('Cascade-Schutz: Parent-Overwrite', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          code: 'ORIG',
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    it('blockt Member, das ganze Family-Tree mit anderem Member-Set zu überschreiben (Kick via Parent)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1').set({
          name: 'Hijack',
          members: { alice: { role: 'member' } },
        })
      );
    });

    it('blockt Member, members-Knoten auf leer zu setzen (vandal kicked all)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1').set({
          name: 'Hijack',
          members: {},
        })
      );
    });

    it('blockt Member, andere Member direkt zu kicken via member-slot remove', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/members/bob').remove()
      );
    });

    it('erlaubt Admin, andere Member zu kicken', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/members/alice').remove()
      );
    });

    it('erlaubt Member, sich selbst zu entfernen (self-leave)', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/members/alice').remove()
      );
    });
  });

  describe('Cascade-Schutz: code/name/meta-Felder', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          code: 'ORIG',
          createdBy: 'bob',
          createdAt: 1000,
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    it('blockt Member, families/code direkt zu überschreiben', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/code').set('PWN')
      );
    });

    it('erlaubt Admin, families/code zu rotieren', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/code').set('NEWCODE')
      );
    });

    it('blockt Member, families/name zu ändern', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/name').set('Vandalism')
      );
    });

    it('erlaubt Admin, families/name zu ändern', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/name').set('Renamed')
      );
    });

    it('blockt Member, createdBy zu manipulieren', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/createdBy').set('alice')
      );
    });
  });

  describe('Member-Schreibrechte auf Familieninhalte', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    it('erlaubt Member, Pantry-Items zu schreiben', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/pantry/item1').set({ name: 'Tomate', amount: 5 })
      );
    });

    it('erlaubt Member, Rezepte zu schreiben', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/recipes/r1').set({ name: 'Pasta', ingredients: [] })
      );
    });

    it('erlaubt Member, Staples zu schreiben', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/staples/s1').set({ name: 'Salz' })
      );
    });

    it('erlaubt Member, Einkaufsliste zu schreiben', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/shoppingList/key1').set({ name: 'Milch', checked: false })
      );
    });

    it('erlaubt Member, Wochenplan zu schreiben', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/weekPlan/Montag/Mittag').set('r1')
      );
    });

    it('blockt Nicht-Member, Pantry-Items zu schreiben', async () => {
      await assertFails(
        authed('charlie').ref('families/-fam1/pantry/item1').set({ name: 'Hijack' })
      );
    });

    it('blockt Schreiben auf unbekanntes Subfeld (default-deny)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog/entry1').set({ action: 'foo' })
      );
    });
  });

  describe('Familien-Erstellung', () => {
    it('erlaubt User, neue Familie mit sich als Admin anzulegen', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-newfam').set({
          name: 'Neue Familie',
          code: 'INIT',
          createdBy: 'alice',
          createdAt: 1000,
          members: { alice: { role: 'admin' } },
        })
      );
    });

    it('blockt User, neue Familie ohne sich als Member anzulegen', async () => {
      await assertFails(
        authed('alice').ref('families/-newfam').set({
          name: 'Steal',
          members: { bob: { role: 'admin' } },
        })
      );
    });

    it('blockt User, neue Familie mit sich als Member (statt Admin) anzulegen', async () => {
      await assertFails(
        authed('alice').ref('families/-newfam').set({
          name: 'Half-baked',
          members: { alice: { role: 'member' } },
        })
      );
    });
  });

  describe('Familien-Löschung', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    it('erlaubt Admin, Familie zu löschen', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1').remove()
      );
    });

    it('blockt Member, Familie zu löschen', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1').remove()
      );
    });
  });

  describe('Längen-/Format-Validierung', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          code: 'ORIG',
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    // ── Familien-Name ──
    it('erlaubt Family-Name an der Boundary (80 Zeichen)', async () => {
      const name80 = 'x'.repeat(80);
      await assertSucceeds(
        authed('bob').ref('families/-fam1/name').set(name80)
      );
    });

    it('blockt Family-Name über Boundary (81 Zeichen)', async () => {
      const name81 = 'x'.repeat(81);
      await assertFails(
        authed('bob').ref('families/-fam1/name').set(name81)
      );
    });

    it('blockt leeren Family-Name', async () => {
      await assertFails(
        authed('bob').ref('families/-fam1/name').set('')
      );
    });

    // ── Code ──
    it('erlaubt Code an Untergrenze (4 Zeichen)', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/code').set('ABCD')
      );
    });

    it('blockt zu kurzen Code (3 Zeichen)', async () => {
      await assertFails(
        authed('bob').ref('families/-fam1/code').set('ABC')
      );
    });

    it('blockt zu langen Code (25 Zeichen)', async () => {
      await assertFails(
        authed('bob').ref('families/-fam1/code').set('A'.repeat(25))
      );
    });

    // ── Role-Enum ──
    it('blockt Admin, fremde Rolle auf nicht-enum-Wert zu setzen', async () => {
      await assertFails(
        authed('bob').ref('families/-fam1/members/alice/role').set('superuser')
      );
    });

    it('erlaubt Admin, Rolle auf "member" zu setzen', async () => {
      await assertSucceeds(
        authed('bob').ref('families/-fam1/members/alice/role').set('member')
      );
    });

    // ── Pantry / Recipe / Shopping ──
    it('erlaubt Pantry-Name an Boundary (80 Zeichen)', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/pantry/i1').set({ name: 'a'.repeat(80) })
      );
    });

    it('blockt Pantry-Name über Boundary (81 Zeichen)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/pantry/i1').set({ name: 'a'.repeat(81) })
      );
    });

    it('blockt überlange Recipe-Description (2001 Zeichen)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/recipes/r1').set({
          name: 'Pasta',
          description: 'x'.repeat(2001),
        })
      );
    });

    it('erlaubt Recipe-Description an Boundary (2000 Zeichen)', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/recipes/r1').set({
          name: 'Pasta',
          description: 'x'.repeat(2000),
        })
      );
    });

    it('blockt überlange Shopping-Item-Name', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/shoppingList/k1').set({
          name: 'a'.repeat(81),
        })
      );
    });

    it('blockt überlange Pantry-Emoji (>8 Zeichen)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/pantry/i1').set({
          name: 'Tomate',
          emoji: 'a'.repeat(9),
        })
      );
    });
  });

  describe('Audit-Log', () => {
    const TS = { '.sv': 'timestamp' }; // Server-Timestamp-Sentinel

    beforeEach(async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1').set({
          name: 'Familie A',
          code: 'ORIG',
          members: {
            bob: { role: 'admin' },
            alice: { role: 'member' },
          },
        });
      });
    });

    it('erlaubt Member, gültigen Eintrag mit Server-Timestamp anzulegen', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/auditLog').push({
          action: 'rotate-code',
          actorUid: 'alice',
          ts: TS,
        })
      );
    });

    it('erlaubt Eintrag mit optionalen Feldern (targetId/targetName/meta/actorName)', async () => {
      await assertSucceeds(
        authed('alice').ref('families/-fam1/auditLog').push({
          action: 'delete-recipe',
          actorUid: 'alice',
          actorName: 'Alice',
          targetId: '-rec1',
          targetName: 'Spaghetti',
          meta: 'manual deletion',
          ts: TS,
        })
      );
    });

    it('blockt Eintrag mit fremder actorUid (Spoofing)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog').push({
          action: 'rotate-code',
          actorUid: 'bob', // gehört nicht zum Auth-User
          ts: TS,
        })
      );
    });

    it('blockt Eintrag mit Client-Timestamp statt Server-Timestamp', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog').push({
          action: 'rotate-code',
          actorUid: 'alice',
          ts: Date.now(), // kein ServerValue.TIMESTAMP
        })
      );
    });

    it('blockt Eintrag von Nicht-Member', async () => {
      await assertFails(
        authed('mallory').ref('families/-fam1/auditLog').push({
          action: 'rotate-code',
          actorUid: 'mallory',
          ts: TS,
        })
      );
    });

    it('blockt Eintrag mit unbekannter action', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog').push({
          action: 'kick-member', // nicht in der Whitelist
          actorUid: 'alice',
          ts: TS,
        })
      );
    });

    it('blockt Eintrag ohne Pflichtfeld (action fehlt)', async () => {
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog').push({
          actorUid: 'alice',
          ts: TS,
        })
      );
    });

    it('blockt Update auf existierenden Eintrag (append-only)', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/auditLog/-e1').set({
          action: 'rotate-code',
          actorUid: 'alice',
          ts: 1700000000000,
        });
      });
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog/-e1').update({ meta: 'tampered' })
      );
    });

    it('blockt Delete eines existierenden Eintrags', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/auditLog/-e1').set({
          action: 'rotate-code',
          actorUid: 'alice',
          ts: 1700000000000,
        });
      });
      await assertFails(
        authed('alice').ref('families/-fam1/auditLog/-e1').remove()
      );
    });

    it('erlaubt Member das Lesen des Audit-Logs', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/auditLog/-e1').set({
          action: 'rotate-code',
          actorUid: 'bob',
          ts: 1700000000000,
        });
      });
      await assertSucceeds(
        authed('alice').ref('families/-fam1/auditLog').once('value')
      );
    });

    it('blockt Lesen für Nicht-Member', async () => {
      await seed(async (db) => {
        await db.ref('families/-fam1/auditLog/-e1').set({
          action: 'rotate-code',
          actorUid: 'bob',
          ts: 1700000000000,
        });
      });
      await assertFails(
        authed('mallory').ref('families/-fam1/auditLog').once('value')
      );
    });
  });
});

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

  describe('User-Audit-Log (cross-family)', () => {
    const TS = { '.sv': 'timestamp' };

    it('erlaubt User, eigenen delete-family-Eintrag anzulegen', async () => {
      await assertSucceeds(
        authed('alice').ref('users/alice/familyAuditLog').push({
          action: 'delete-family',
          actorUid: 'alice',
          targetId: '-fam1',
          targetName: 'Familie A',
          ts: TS,
        })
      );
    });

    it('blockt Eintrag in fremdem User-Pfad', async () => {
      await assertFails(
        authed('alice').ref('users/bob/familyAuditLog').push({
          action: 'delete-family',
          actorUid: 'alice',
          ts: TS,
        })
      );
    });

    it('blockt Lesen fremder User-Logs', async () => {
      await seed(async (db) => {
        await db.ref('users/bob/familyAuditLog/-e1').set({
          action: 'delete-family',
          actorUid: 'bob',
          ts: 1700000000000,
        });
      });
      await assertFails(
        authed('alice').ref('users/bob/familyAuditLog').once('value')
      );
    });

    it('blockt Update auf bestehenden eigenen Eintrag (append-only)', async () => {
      await seed(async (db) => {
        await db.ref('users/alice/familyAuditLog/-e1').set({
          action: 'delete-family',
          actorUid: 'alice',
          ts: 1700000000000,
        });
      });
      await assertFails(
        authed('alice').ref('users/alice/familyAuditLog/-e1').update({ meta: 'tampered' })
      );
    });

    it('blockt Delete auf bestehenden eigenen Eintrag', async () => {
      await seed(async (db) => {
        await db.ref('users/alice/familyAuditLog/-e1').set({
          action: 'delete-family',
          actorUid: 'alice',
          ts: 1700000000000,
        });
      });
      await assertFails(
        authed('alice').ref('users/alice/familyAuditLog/-e1').remove()
      );
    });

    it('blockt unbekannte action im User-Log', async () => {
      await assertFails(
        authed('alice').ref('users/alice/familyAuditLog').push({
          action: 'rotate-code', // gehört in family-scoped Log, nicht hier
          actorUid: 'alice',
          ts: TS,
        })
      );
    });

    it('blockt Spoofing der actorUid im User-Log', async () => {
      await assertFails(
        authed('alice').ref('users/alice/familyAuditLog').push({
          action: 'delete-family',
          actorUid: 'bob',
          ts: TS,
        })
      );
    });

    it('blockt Client-Timestamp im User-Log', async () => {
      await assertFails(
        authed('alice').ref('users/alice/familyAuditLog').push({
          action: 'delete-family',
          actorUid: 'alice',
          ts: Date.now(),
        })
      );
    });
  });

  describe('User-Pfad-Refactor (granulare Rules)', () => {
    it('erlaubt User, eigenes name-Feld zu setzen', async () => {
      await assertSucceeds(
        authed('alice').ref('users/alice/name').set('Alice Müller')
      );
    });

    it('erlaubt initiales Multi-Update bei Registrierung', async () => {
      // App nutzt update() statt set() für Registrierung, weil set() auf Parent
      // eine Top-Level-.write bräuchte, die wir bewusst nicht mehr haben
      // (sonst könnte User seinen familyAuditLog manipulieren).
      await assertSucceeds(
        authed('alice').ref('users/alice').update({
          name: 'Alice',
          email: 'alice@example.com',
          createdAt: 1700000000000,
        })
      );
    });

    it('blockt set() auf User-Parent (Schutz vor Audit-Log-Tampering via Multi-Set)', async () => {
      await seed(async (db) => {
        await db.ref('users/alice/familyAuditLog/-e1').set({
          action: 'delete-family',
          actorUid: 'alice',
          ts: 1700000000000,
        });
      });
      // Ein set() auf users/alice würde familyAuditLog implizit löschen.
      // Da Top-Level keine .write-Rule mehr hat, wird das geblockt.
      await assertFails(
        authed('alice').ref('users/alice').set({
          name: 'New Name',
        })
      );
    });

    it('blockt Schreiben in fremden User-Pfad', async () => {
      await assertFails(
        authed('alice').ref('users/bob/name').set('Hijack')
      );
    });

    it('blockt überlangen User-Namen', async () => {
      await assertFails(
        authed('alice').ref('users/alice/name').set('x'.repeat(81))
      );
    });

    it('erlaubt families-Map-Update', async () => {
      await assertSucceeds(
        authed('alice').ref('users/alice/families/-fam1').set({
          name: 'Familie A',
          role: 'admin',
        })
      );
    });

    it('blockt invalide role im families-Map', async () => {
      await assertFails(
        authed('alice').ref('users/alice/families/-fam1').set({
          name: 'Familie A',
          role: 'superuser',
        })
      );
    });
  });

  describe('Admin-Pfad + Feedback', () => {
    const TS = { '.sv': 'timestamp' };
    // Bootstrap-Admin-UID aus den Rules
    const ADMIN_UID = 'ZntXAQlTABT5zKTsMHs9nwHVdpl1';

    describe('admins/$uid', () => {
      it('erlaubt Admin (hartkodiert), neuen Admin einzutragen', async () => {
        await assertSucceeds(
          authed(ADMIN_UID).ref('admins/charlie').set(true)
        );
      });

      it('blockt Nicht-Admin, sich selbst als Admin einzutragen', async () => {
        await assertFails(
          authed('mallory').ref('admins/mallory').set(true)
        );
      });

      it('erlaubt User, eigenen Admin-Status zu lesen', async () => {
        await seed(async (db) => {
          await db.ref('admins/alice').set(true);
        });
        await assertSucceeds(
          authed('alice').ref('admins/alice').once('value')
        );
      });

      it('blockt User, fremden Admin-Status zu lesen', async () => {
        await seed(async (db) => {
          await db.ref('admins/bob').set(true);
        });
        await assertFails(
          authed('alice').ref('admins/bob').once('value')
        );
      });

      it('erlaubt eingetragenem Admin, weitere Admins anzulegen', async () => {
        await seed(async (db) => {
          await db.ref('admins/alice').set(true);
        });
        await assertSucceeds(
          authed('alice').ref('admins/charlie').set(true)
        );
      });
    });

    describe('feedback/$entryId', () => {
      it('erlaubt User, eigenes Feedback einzureichen', async () => {
        await assertSucceeds(
          authed('alice').ref('feedback').push({
            type: 'bug',
            message: 'Crash beim Login',
            userUid: 'alice',
            ts: TS,
            status: 'new',
          })
        );
      });

      it('erlaubt optionale Felder (email/version/page/ua)', async () => {
        await assertSucceeds(
          authed('alice').ref('feedback').push({
            type: 'wish',
            message: 'Dark Mode wäre toll',
            userUid: 'alice',
            userEmail: 'alice@example.com',
            ts: TS,
            status: 'new',
            version: '0.9.15',
            page: 'recipes-page',
            ua: 'Mozilla/5.0',
          })
        );
      });

      it('blockt Spoofing der userUid', async () => {
        await assertFails(
          authed('alice').ref('feedback').push({
            type: 'bug',
            message: 'fake',
            userUid: 'bob',
            ts: TS,
            status: 'new',
          })
        );
      });

      it('blockt Client-Timestamp', async () => {
        await assertFails(
          authed('alice').ref('feedback').push({
            type: 'bug',
            message: 'fake',
            userUid: 'alice',
            ts: Date.now(),
            status: 'new',
          })
        );
      });

      it('blockt initialen status != new', async () => {
        await assertFails(
          authed('alice').ref('feedback').push({
            type: 'bug',
            message: 'fake',
            userUid: 'alice',
            ts: TS,
            status: 'done',
          })
        );
      });

      it('blockt unbekannten type', async () => {
        await assertFails(
          authed('alice').ref('feedback').push({
            type: 'spam',
            message: 'x',
            userUid: 'alice',
            ts: TS,
            status: 'new',
          })
        );
      });

      it('blockt zu lange message (>2000)', async () => {
        await assertFails(
          authed('alice').ref('feedback').push({
            type: 'bug',
            message: 'x'.repeat(2001),
            userUid: 'alice',
            ts: TS,
            status: 'new',
          })
        );
      });

      it('blockt leere message', async () => {
        await assertFails(
          authed('alice').ref('feedback').push({
            type: 'bug',
            message: '',
            userUid: 'alice',
            ts: TS,
            status: 'new',
          })
        );
      });

      it('blockt Lesen für Nicht-Admin', async () => {
        await seed(async (db) => {
          await db.ref('feedback/-e1').set({
            type: 'bug', message: 'x', userUid: 'alice',
            ts: 1700000000000, status: 'new',
          });
        });
        await assertFails(
          authed('alice').ref('feedback').once('value')
        );
      });

      it('erlaubt Lesen für Admin', async () => {
        await seed(async (db) => {
          await db.ref('feedback/-e1').set({
            type: 'bug', message: 'x', userUid: 'alice',
            ts: 1700000000000, status: 'new',
          });
        });
        await assertSucceeds(
          authed(ADMIN_UID).ref('feedback').once('value')
        );
      });

      it('blockt User-Update auf eigenes Feedback (append-only)', async () => {
        await seed(async (db) => {
          await db.ref('feedback/-e1').set({
            type: 'bug', message: 'x', userUid: 'alice',
            ts: 1700000000000, status: 'new',
          });
        });
        await assertFails(
          authed('alice').ref('feedback/-e1/status').set('done')
        );
      });

      it('erlaubt Admin-Update (status-Wechsel)', async () => {
        await seed(async (db) => {
          await db.ref('feedback/-e1').set({
            type: 'bug', message: 'x', userUid: 'alice',
            ts: 1700000000000, status: 'new',
          });
        });
        await assertSucceeds(
          authed(ADMIN_UID).ref('feedback/-e1/status').set('done')
        );
      });

      it('erlaubt Admin-Delete', async () => {
        await seed(async (db) => {
          await db.ref('feedback/-e1').set({
            type: 'bug', message: 'x', userUid: 'alice',
            ts: 1700000000000, status: 'new',
          });
        });
        await assertSucceeds(
          authed(ADMIN_UID).ref('feedback/-e1').remove()
        );
      });

      it('blockt User-Delete eines fremden Feedbacks', async () => {
        await seed(async (db) => {
          await db.ref('feedback/-e1').set({
            type: 'bug', message: 'x', userUid: 'alice',
            ts: 1700000000000, status: 'new',
          });
        });
        await assertFails(
          authed('mallory').ref('feedback/-e1').remove()
        );
      });
    });

    describe('systemBanner', () => {
      it('erlaubt Lesen für jeden eingeloggten User', async () => {
        await seed(async (db) => {
          await db.ref('systemBanner').set({ text: 'Wartung', severity: 'info', active: true, updatedAt: 1700000000000 });
        });
        await assertSucceeds(authed('alice').ref('systemBanner').once('value'));
      });

      it('blockt Schreiben für Nicht-Admin', async () => {
        await assertFails(
          authed('alice').ref('systemBanner').set({ text: 'Hack', severity: 'info', active: true, updatedAt: 1700000000000 })
        );
      });

      it('erlaubt Schreiben für Admin', async () => {
        await assertSucceeds(
          authed(ADMIN_UID).ref('systemBanner').set({ text: 'Wartung Sonntag', severity: 'warning', active: true, updatedAt: 1700000000000 })
        );
      });

      it('blockt zu langen Banner-Text (>280)', async () => {
        await assertFails(
          authed(ADMIN_UID).ref('systemBanner').set({ text: 'x'.repeat(281), severity: 'info', active: true, updatedAt: 1700000000000 })
        );
      });

      it('blockt invalide severity', async () => {
        await assertFails(
          authed(ADMIN_UID).ref('systemBanner').set({ text: 'x', severity: 'critical', active: true, updatedAt: 1700000000000 })
        );
      });
    });

    describe('publicRecipes (Marktplatz)', () => {
      beforeEach(async () => {
        await seed(async (db) => {
          await db.ref('families/-fam1').set({
            name: 'Familie A',
            code: 'ORIG',
            members: {
              alice: { role: 'admin' },
              bob:   { role: 'member' },
            },
          });
        });
      });

      it('erlaubt Family-Admin zu veröffentlichen', async () => {
        await assertSucceeds(
          authed('alice').ref('publicRecipes').push({
            name: 'Pasta',
            sourceFamilyId: '-fam1',
            sourceRecipeId: '-rec1',
            publishedAt: 1700000000000,
            copies: 0,
          })
        );
      });

      it('blockt Family-Member (kein Admin) zu veröffentlichen', async () => {
        await assertFails(
          authed('bob').ref('publicRecipes').push({
            name: 'Pasta',
            sourceFamilyId: '-fam1',
            sourceRecipeId: '-rec1',
            publishedAt: 1700000000000,
            copies: 0,
          })
        );
      });

      it('blockt Outsider zu veröffentlichen', async () => {
        await assertFails(
          authed('mallory').ref('publicRecipes').push({
            name: 'Spam',
            sourceFamilyId: '-fam1',
            sourceRecipeId: '-rec1',
            publishedAt: 1700000000000,
            copies: 0,
          })
        );
      });

      it('erlaubt jedem Auth-User Lesen', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Pasta', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
          });
        });
        await assertSucceeds(authed('mallory').ref('publicRecipes').once('value'));
      });

      it('erlaubt copies-Inkrement durch jeden Auth-User', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Pasta', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 5,
          });
        });
        await assertSucceeds(
          authed('mallory').ref('publicRecipes/-pub1/copies').set(6)
        );
      });

      it('blockt copies-Sprung (nicht +1)', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Pasta', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 5,
          });
        });
        await assertFails(
          authed('mallory').ref('publicRecipes/-pub1/copies').set(50)
        );
      });

      it('blockt Update auf Inhalts-Felder (nur copies erlaubt)', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Pasta', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
          });
        });
        await assertFails(
          authed('alice').ref('publicRecipes/-pub1/name').set('Hijacked')
        );
      });

      it('erlaubt Family-Admin zu unpublishen', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Pasta', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
          });
        });
        await assertSucceeds(
          authed('alice').ref('publicRecipes/-pub1').remove()
        );
      });

      it('blockt Family-Member zu unpublishen', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Pasta', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
          });
        });
        await assertFails(
          authed('bob').ref('publicRecipes/-pub1').remove()
        );
      });

      it('erlaubt globalem App-Admin zu moderieren (delete)', async () => {
        await seed(async (db) => {
          await db.ref('publicRecipes/-pub1').set({
            name: 'Spam', sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
          });
        });
        await assertSucceeds(
          authed(ADMIN_UID).ref('publicRecipes/-pub1').remove()
        );
      });

      it('blockt zu langen Namen (>100)', async () => {
        await assertFails(
          authed('alice').ref('publicRecipes').push({
            name: 'x'.repeat(101),
            sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
          })
        );
      });

      it('blockt unbekanntes Top-Level-Feld ($other)', async () => {
        await assertFails(
          authed('alice').ref('publicRecipes').push({
            name: 'Pasta',
            sourceFamilyId: '-fam1', sourceRecipeId: '-rec1',
            publishedAt: 1700000000000, copies: 0,
            evilField: 'inject',
          })
        );
      });
    });

    describe('stats', () => {
      it('erlaubt jedem eingeloggten User, Counter zu inkrementieren', async () => {
        await assertSucceeds(authed('alice').ref('stats/userCount').set(1));
        await assertSucceeds(authed('alice').ref('stats/familyCount').set(5));
      });

      it('blockt negative Werte', async () => {
        await assertFails(authed('alice').ref('stats/userCount').set(-1));
      });

      it('blockt Lesen für Nicht-Admin', async () => {
        await seed(async (db) => {
          await db.ref('stats').set({ userCount: 10, familyCount: 3 });
        });
        await assertFails(authed('alice').ref('stats').once('value'));
      });

      it('erlaubt Lesen für Admin', async () => {
        await seed(async (db) => {
          await db.ref('stats').set({ userCount: 10, familyCount: 3 });
        });
        await assertSucceeds(authed(ADMIN_UID).ref('stats').once('value'));
      });
    });
  });
});

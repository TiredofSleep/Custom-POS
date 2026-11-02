'use strict';
/* ============================================================================
 * THE SHOP'S ABILITIES — what a person here can be allowed to do, and what each role may do before the owner changes it
 * @permission @employee @owner — the shop's own list (v1 verbatim); core/staff.js is the same for every business, and this file is the part a business writes for itself
 * ----------------------------------------------------------------------------
 * Owner, 11/1: "we are trying to build a modular system so nobody has to spend the money to do this work again... copy,
 * paste, customize". core/staff.js (roles, PINs, can()) is shared as it is. This file is the shop's, a cleaner's: the
 * twelve abilities v1's Admin lists, in v1's order, and v1's built-in role defaults (v1 ABILITIES / ROLE_PERMS, verbatim).
 * Another business keeps core/staff.js as it is and writes its own copy of this file (start from this one). "unrack" is a
 * cleaner's ability; a restaurant leaves it out. staff.abilitiesFrom(list) checks a list the way the start does.
 *
 *   · ABILITIES: [key, the words on the Admin screen], in the order the screen lists them.
 *   · ROLE_PERMS: what owner, manager and staff may do until the shop changes a role (Admin → Roles). The owner may do
 *     everything whatever this says (staff.can); the owner's list here only fills that role's boxes on the screen.
 *   · At most 40 abilities, each with its words. A wrong key, a missing word, a role that is not owner, manager or staff,
 *     or a default naming no ability stops the start and names this file (staff.abilitiesFrom).
 *   · ONCE ANY FACT NAMES AN ABILITY, ITS KEY STAYS. Change its words freely, but never delete or rename the key: every
 *     tablet set up later checks the shop's old facts by this list, and would refuse a person's old change that names a key
 *     no longer here (with whatever else that change said, such as making them inactive). A new shop with no history may
 *     write the list any way it likes.
 *   · A module that brings its own action adds it when it loads: staff.addAbility(key, words, roles), called from the
 *     module's aggregates/ file, which the hub loads too. An ability only the tablet knows makes the hub refuse every role
 *     list and every person's change that names it.
 * ========================================================================== */
module.exports = {
  ABILITIES: [['admin', 'Open the Admin area'], ['drawer', 'Cash drawer in/out'], ['void', 'Void orders'], ['unrack', 'Un-rack ready orders (send back to production)'], ['adjust', 'Discounts & manual adjustments'], ['reports', 'View reports'], ['customers', 'Edit customers'], ['payroll', 'Edit PAYROLL (time entries & pay rates) — official record, logged'], ['employees', 'Manage employees'], ['prices', 'Edit prices & upcharges'], ['settings', 'Change settings & tax'], ['reset', 'Reset data']],
  ROLE_PERMS: { owner: ['admin', 'drawer', 'void', 'unrack', 'adjust', 'reports', 'customers', 'employees', 'payroll', 'prices', 'settings', 'reset'], manager: ['admin', 'drawer', 'void', 'unrack', 'adjust', 'reports', 'customers'], staff: ['unrack'] }
};

import { updateProfileSchema, loginSchema, registerSchema } from '../../../../server/src/modules/auth/validation.ts'
console.log(JSON.stringify(updateProfileSchema.safeParse({ full_name: 'Abc Def' })))
console.log(JSON.stringify(loginSchema.safeParse({}).error?.issues.map(i=>[i.path,i.message])))
console.log(JSON.stringify(registerSchema.safeParse({ full_name:'a', email:'x', password:'abc', requested_role:'attendee', conference_id:'nope'}).error?.issues.map(i=>[i.path,i.message])))
console.log(JSON.stringify(registerSchema.safeParse({ full_name:'Abc', email:'x@y.co', phone:'9812345678', password:'Abcdef1!', requested_role:'attendee', conference_id:'11111111-1111-1111-8111-111111111111'}).error?.issues.map(i=>[i.path,i.message])))
